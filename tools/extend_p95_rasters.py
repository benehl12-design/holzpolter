#!/usr/bin/env python3
"""One-time import of official P95 laser-canopy statistic for Sarvisvaara.
P95 is NOT measured dominant height (Hdom); never overwrite dominant_height_m.
The official raw P95 raster stores decimetres and is clipped without resampling.
"""
import datetime as dt
import hashlib
import itertools
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

import numpy as np
import rasterio
from rasterio.windows import from_bounds

URL="https://geodpags.skogsstyrelsen.se/geodataport/data/sks_P95_omdrev2_25.zip"
OUT=Path("data/forest-rasters")
MAX_BYTES=1_100_000_000

def download(path):
    request=urllib.request.Request(URL,headers={"User-Agent":"Lignum-Forestry-Data/1.0"})
    digest=hashlib.sha256()
    total=0
    with urllib.request.urlopen(request,timeout=90) as src,open(path,"wb") as dest:
        if src.status!=200:raise RuntimeError("ZIP fetch failed: "+str(src.status))
        expected=int(src.headers.get("Content-Length","0"))
        if not 500_000_000<expected<MAX_BYTES:raise RuntimeError("Unexpected P95 ZIP size: "+str(expected))
        while True:
            chunk=src.read(4*1024*1024)
            if not chunk:break
            total+=len(chunk)
            if total>MAX_BYTES:raise RuntimeError("P95 archive too large")
            digest.update(chunk);dest.write(chunk)
            if total//(100*1024*1024)!=(total-len(chunk))//(100*1024*1024):
                print("Downloaded",round(total/1e6),"MB",flush=True)
    if total!=expected:raise RuntimeError("P95 ZIP transfer incomplete")
    return digest.hexdigest(),total

def rle(values):
    return [[int(v),sum(1 for _ in group)]
            for v,group in itertools.groupby(values.ravel().tolist())]

def build():
    index_path=OUT/"index.json"
    info=json.loads(index_path.read_text())
    if info.get("schema")!="lignum-raster-index-v1":raise RuntimeError("Invalid current raster index")
    bounds=info["bounds"]
    if bounds!=[780000,7413000,790000,7423000]:raise RuntimeError("Review region before P95 import")
    tiles=info["tiles"]
    with tempfile.TemporaryDirectory() as temp:
        archive=Path(temp)/"p95.zip"
        digest,size=download(archive)
        with zipfile.ZipFile(archive) as pack:
            bad=pack.testzip()
            if bad:raise RuntimeError("P95 ZIP failed CRC at "+bad)
            members=[f.filename for f in pack.infolist() if f.filename.lower().endswith((".tif",".tiff"))]
        print("P95 TIFF members",len(members),members[:5],flush=True)
        if len(members)!=1:raise RuntimeError("Expected exactly one P95 GeoTIFF: inspect before publishing")
        source=f"/vsizip/{archive.resolve()}/{members[0]}"
        with rasterio.open(source) as ds:
            print("P95 raster",ds.crs,ds.bounds,ds.res,ds.dtypes,ds.nodata,flush=True)
            if ds.crs.to_epsg()!=3006:raise RuntimeError("P95 must be EPSG:3006")
            if ds.res[0]!=ds.res[1] or ds.res[0] not in (10,12.5):raise RuntimeError("Unexpected P95 native step")
            xmin,ymin,xmax,ymax=bounds
            window=from_bounds(xmin,ymin,xmax,ymax,ds.transform).round_offsets().round_lengths()
            data=ds.read(1,window=window,boundless=True,masked=True)
            transform=ds.window_transform(window)
            if abs(transform.c-xmin)>.001 or abs(transform.f-ymax)>.001:raise RuntimeError("P95 grid offset; do not resample")
            raw=data.filled(-1).astype('int32')
            raw[(~np.isfinite(data.data))|(data.data<0)]=-1
            valid=(raw>0)&(raw<=650)
            print("P95 valid",int(valid.sum()),"range",(int(raw[valid].min()) if valid.any() else None,int(raw[valid].max()) if valid.any() else None),flush=True)
            if valid.sum()<1000:raise RuntimeError("No valid P95 data for region")
            step=ds.res[0]
            new_tiles=[]
            for item in tiles:
                oldfile=OUT/item["file"]
                tile=json.loads(oldfile.read_text())
                x,y=tile["bounds"][:2]
                pixels=int(1000/step)
                col=int((x-xmin)/step)
                row=int((ymax-y-1000)/step)
                part=raw[row:row+pixels,col:col+pixels]
                if part.shape!=(pixels,pixels):raise RuntimeError("P95 tile-grid mismatch")
                tile["layers"]["p95_2"]={"x":x,"y":y+1000,"step":step,
                   "width":pixels,"height":pixels,"runs":rle(part)}
                payload=json.dumps(tile,ensure_ascii=False,separators=(",",":")).encode()
                sha=hashlib.sha256(payload).hexdigest()
                filename=f"{x}_{y}-{sha[:12]}.json"
                (OUT/filename).write_bytes(payload)
                new_tiles.append({"file":filename,"bounds":tile["bounds"],"sha256":sha,"bytes":len(payload)})
            info["sources"]["p95_2"]={
                "name":"Skogsstyrelsen Skogliga grunddata · P95 Laserhöhen-Perzentil · Omdrev 2",
                "year":None,"file":"sks_P95_omdrev2_25.zip","sha256":digest,
                "url":URL,"scale":0.1,
                "licence_url":"https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/",
                "note":"95. Höhenperzentil der Laserreturen in dm; kein gemessener Oberhöhenwert Hdom. Aufnahmedatum aus separatem 2,5-km-Metadatengitter."
            }
            info["tiles"]=new_tiles
            info["built_on"]=dt.date.today().isoformat()
            info.setdefault("notes",[]).append("P95 ist eine Höhenkennzahl der Laserscans, nicht die gemessene Oberhöhe des Bestandes.")
            index_path.write_text(json.dumps(info,ensure_ascii=False,indent=2)+"\n")
            for item in tiles:
                old=OUT/item["file"]
                if old.exists() and item["file"] not in {new["file"] for new in new_tiles}:
                    old.unlink()
            print("P95 published",len(new_tiles),"tiles",size,"archive bytes",flush=True)
if __name__=="__main__":
    build()
