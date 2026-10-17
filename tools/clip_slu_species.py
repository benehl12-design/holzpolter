#!/usr/bin/env python3
"""Read native regional cells from SLU's public 2018 GeoTIFF files, without an API.

The 2015 species product stops south of Sarvisvaara. The national 2018 product
uses satellite images from 2017-2019; original national files remain at SLU.
HTTP range reads transfer the source TIFF strips needed by this region.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

import rasterio
from rasterio.windows import from_bounds

BASE='https://gis.slu.se/data/slu_forest_map/2018/'
SPECIES={'pine':'Tall','spruce':'Gran','birch':'Bjork','contorta':'Contorta','oak':'Ek','beech':'Bok','broadleaf':'OvrLov'}


def clip_one(entry,destination,bounds):
    key,swedish=entry
    url=BASE+'data/'+swedish+'_andel.tif'
    path=destination/('SLU_2018_'+key+'_Sarvisvaara.tif')
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT=90):
        with rasterio.open('/vsicurl/'+url) as source:
            if source.res!=(12.5,12.5) or not source.crs.is_projected or source.crs.linear_units!='metre':
                raise ValueError('Unexpected source grid; review SLU product documentation')
            window=from_bounds(*bounds,source.transform).round_offsets().round_lengths()
            transform=source.window_transform(window)
            if abs(transform.c-bounds[0])>.001 or abs(transform.f-bounds[3])>.001:
                raise ValueError('Bounds must align to native 12.5-m cells')
            values=source.read(1,window=window,masked=True).filled(-1)
            if values.min()< -1 or values.max()>100:
                raise ValueError('Species percentage is outside the documented range')
            # SLU's WKT is generic GRS80/UTM33; the product documentation explicitly
            # specifies EPSG:3006. No coordinates/cells are resampled or moved.
            with rasterio.open(path,'w',driver='GTiff',width=values.shape[1],height=values.shape[0],count=1,
                               dtype='int16',crs='EPSG:3006',transform=transform,nodata=-1,compress='deflate',tiled=True) as out:
                out.write(values,1)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    print('SLU 2018',key,'clipped',values.shape,flush=True)
    return {'id':'species2018_'+key,'group':'species2018','metric':'species_share','scale':1,
            'year':None,'product_year':2018,'image_years':[2017,2018,2019],'url':url,
            'local_file':path.name,'bytes':path.stat().st_size,'sha256':digest,
            'rasters':[{'name':path.name}], 'bounds':bounds,
            'method':'Native regional GeoTIFF cells via static HTTP range reads; no national full download and no API'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',required=True,type=Path)
    parser.add_argument('--bounds',required=True,nargs=4,type=int)
    args=parser.parse_args();args.destination.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        datasets=list(pool.map(lambda entry:clip_one(entry,args.destination,args.bounds),SPECIES.items()))
    doc=args.destination/'SLU-Tradslag-2018.docx'
    doc.write_bytes(urllib.request.urlopen(BASE+'docs/Tradslag_SLUskogskarta.docx',timeout=45).read())
    report={'schema':'lignum-slu-species-2018-v1','datasets':datasets,'documentation_url':BASE+'docs/Tradslag_SLUskogskarta.docx',
            'note':'Percentages of volume; imagery mainly 2018, sometimes 2017/2019. More northern coverage than the 2015 product.','errors':[]}
    (args.destination/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    with zipfile.ZipFile(args.destination/'SLU-2018-Sarvisvaara.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for item in datasets:archive.write(args.destination/item['local_file'],item['local_file'])
        archive.write(doc,doc.name);archive.write(args.destination/'report.json','report.json')


if __name__=='__main__':main()
