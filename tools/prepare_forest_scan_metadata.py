#!/usr/bin/env python3
"""Fetch public, spatially referenced Lantmäteriet/Skogsstyrelsen 2.5 km laser scan metadata.
This creates a small, reviewable *public* file for Lignum's Sarvisvaara raster extent.
Never infer acquisition dates from source names or age-map product dates.
"""
import argparse
import datetime as dt
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = ("https://geodpags.skogsstyrelsen.se/arcgis/rest/services/"
            "Geodataportal/GeodataportalVisaSkogligaGrunddataMetadata/MapServer/0/query")
BOUNDS = (780000, 7413000, 790000, 7423000)

def parse_date(value):
    match = re.match(r"^((?:19|20)\d{2})[-/.]?([01]\d)[-/.]?([0-3]\d)", str(value or ""))
    if not match:
        return None
    year, month, day = map(int, match.groups())
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None

def fetch(url=ENDPOINT, bounds=BOUNDS, timeout=35):
    params = {
        "f": "json", "where": "1=1", "outFields": "Indexruta,Datum,Omdrev",
        "geometry": json.dumps({"xmin": bounds[0], "ymin": bounds[1],
                                "xmax": bounds[2], "ymax": bounds[3],
                                "spatialReference": {"wkid": 3006}}, separators=(',', ':')),
        "geometryType": "esriGeometryEnvelope", "inSR": "3006",
        "outSR": "3006", "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true", "resultRecordCount": "2000",
    }
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": "Lignum-Forestry-Data/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise RuntimeError("ArcGIS error: " + str(payload["error"]))
    if payload.get("exceededTransferLimit"):
        raise RuntimeError("Scan metadata transfer limit exceeded")
    if not isinstance(payload.get("features"), list):
        raise RuntimeError("Missing scan metadata features")
    return payload["features"]

def compile_metadata(features, bounds=BOUNDS):
    rows = []
    for item in features:
        props = item.get("attributes") or {}
        date = parse_date(props.get("Datum"))
        cycle_match = re.search(r"\b([123])\b", str(props.get("Omdrev", "")))
        rings = (item.get("geometry") or {}).get("rings") or []
        if not date or not cycle_match or not rings:
            continue
        if not all(len(ring)>=4 and all(len(p)>=2 and
                   all(isinstance(v,(int,float)) and abs(v)<1e9 for v in p[:2])
                   for p in ring) for ring in rings):
            continue
        xs=[p[0] for r in rings for p in r]
        ys=[p[1] for r in rings for p in r]
        if max(xs)<bounds[0] or min(xs)>bounds[2] or max(ys)<bounds[1] or min(ys)>bounds[3]:
            continue
        rows.append({"cycle": int(cycle_match.group(1)), "date": date,
                     "grid": str(props.get("Indexruta") or "")[:60],
                     "rings": [[[round(p[0],2),round(p[1],2)] for p in ring] for ring in rings]})
    # Duplicates are possible in ArcGIS services; keep one per grid/cycle/date.
    unique={ (r["cycle"],r["date"],r["grid"]):r for r in rows }
    rows=sorted(unique.values(), key=lambda x:(x["cycle"],x["grid"],x["date"]))
    if not rows:
        raise RuntimeError("No usable scan dates for the Sarvisvaara region – do not publish guesses")
    return {"schema": "lignum-scan-metadata-v1", "bounds": list(bounds),
            "source": ENDPOINT, "crs": "EPSG:3006",
            "note": "Scanned date per public 2.5 km grid and cycle. Distinct from age-model reference year and from measured tree height.",
            "grids": rows}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=Path("data/forest-rasters/scan-metadata.json"))
    args=parser.parse_args()
    result=compile_metadata(fetch())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+"\n",encoding="utf-8")
    dates={}
    for rec in result["grids"]:
        d=dates.setdefault(rec["cycle"],[])
        d.append(rec["date"])
    print("Saved",len(result["grids"]),"official scan grids", {k:(min(v),max(v)) for k,v in dates.items()})

if __name__=="__main__":
    main()
