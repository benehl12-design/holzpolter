#!/usr/bin/env python3
"""Clip Skogsstyrelsen GeoTIFFs / county ZIPs to Lignum stands; no national files enter the phone.

python tools/forest_rasters.py --stands stands.geojson --volume county.zip --age age.zip \
  --height height.tif --height-scale 0.1 --year 2022 --output enriched.geojson

Each raster is explicitly assigned to a variable. A ZIP must contain exactly one TIFF,
or use /absolute/archive.zip!path/inside.tif. No archives are extracted.
"""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import zipfile
import numpy as np
import rasterio
from rasterio.windows import from_bounds, Window
from rasterio.features import shapes
from rasterio.warp import transform_geom
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union


def dataset_path(value):
    if "!" in value:
        archive, member = value.split("!", 1)
        return f"/vsizip/{Path(archive).resolve()}/{member}"
    path = Path(value).resolve()
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            members = [n for n in archive.namelist() if n.lower().endswith((".tif", ".tiff"))]
        if len(members) != 1:
            raise ValueError(f"{path.name}: {len(members)} TIFFs; choose archive.zip!member.tif explicitly")
        return f"/vsizip/{path}/{members[0]}"
    return str(path)


def metric_geometry(geometry):
    return shape(transform_geom("EPSG:4326", "EPSG:3006", geometry))


def check_dataset(ds):
    if not ds.crs or not ds.crs.is_projected or ds.crs.linear_units != 'metre':
        raise ValueError('Raster must use a projected CRS with metre units, e.g. EPSG:3006')
    if ds.transform.b or ds.transform.d:
        raise ValueError('Rotated raster grids must be reprojected before import')


def clipped_window(ds, geometry):
    check_dataset(ds)
    g = shape(transform_geom('EPSG:4326', ds.crs, geometry))
    if not g.is_valid or g.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('A valid WGS84 Polygon or MultiPolygon is required')
    clipped = g.intersection(box(*ds.bounds))
    if clipped.is_empty or not clipped.area:
        return g, clipped, None
    window = from_bounds(*clipped.bounds, ds.transform).round_offsets().round_lengths()
    window = Window(max(0, window.col_off-1), max(0, window.row_off-1), window.width+2, window.height+2)
    window = window.intersection(Window(0, 0, ds.width, ds.height))
    if window.width * window.height > 5_000_000:
        raise ValueError('Stand is too large for this raster resolution; split the stand first')
    return g, clipped, window


def cell_weights(clipped, transform, valid):
    for row, col in np.argwhere(valid):
        x1, y1 = transform * (int(col), int(row))
        x2, y2 = transform * (int(col)+1, int(row)+1)
        weight = clipped.intersection(box(min(x1,x2),min(y1,y2),max(x1,x2),max(y1,y2))).area
        if weight:
            yield row, col, weight


def read_metric(geometry, filename, scale=1., zero_nodata=True):
    """Use intersection area of every raster cell; do not count NoData as zero."""
    with rasterio.open(dataset_path(filename)) as ds:
        _, clipped, window = clipped_window(ds, geometry)
        if window is None:
            return None
        data = ds.read(1, window=window, masked=True)
        trans = ds.window_transform(window)
        valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data) & (data.data >= 0)
        if zero_nodata:
            valid &= data.data > 0
        weighted = covered = 0.
        for row, col, weight in cell_weights(clipped, trans, valid):
            covered += weight
            weighted += float(data[row,col]) * scale * weight
        if not covered:
            return None
        return {"mean": weighted/covered, "area_ha": covered/10000, "integral_ha": weighted/10000}


def read_species(geometry, rasters):
    """Shares use exactly the same valid cells; absent species (0) remain valid."""
    keys = ('pine', 'spruce', 'birch', 'other')
    if not all(rasters.get(k) for k in keys):
        raise ValueError('Species shares require pine, spruce, birch and other (sum additional species first)')
    with ExitStack() as stack:
        datasets = {k:stack.enter_context(rasterio.open(dataset_path(rasters[k]))) for k in keys}
        first = datasets['pine']
        for ds in datasets.values():
            check_dataset(ds)
            if ds.crs != first.crs or ds.transform != first.transform or ds.shape != first.shape:
                raise ValueError('Species rasters must share CRS, pixel grid and extent; align them first')
        _, clipped, window = clipped_window(first, geometry)
        if window is None:
            return None
        values = {k:ds.read(1, window=window, masked=True) for k,ds in datasets.items()}
        valid = np.ones(values['pine'].shape, dtype=bool)
        for data in values.values():
            valid &= ~np.ma.getmaskarray(data) & np.isfinite(data.data) & (data.data >= 0)
        valid &= sum(data.data.astype('float64') for data in values.values()) > 0
        totals = dict.fromkeys(keys, 0.)
        covered = 0.
        for row,col,weight in cell_weights(clipped, first.window_transform(window), valid):
            covered += weight
            for k in keys:
                totals[k] += float(values[k][row,col]) * weight
        total = sum(totals.values())
        if not covered or not total:
            return None
        pct = {k:round(v/total*100,4) for k,v in totals.items()}
        pct['other'] = round(pct['other']+100-sum(pct.values()),4)
        return {'shares':pct, 'area_ha':covered/10000}


def polygon_parts(geometry):
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    return unary_union([p for p in geometry.geoms if p.geom_type in ('Polygon','MultiPolygon')])


def automatic_stands(feature, raster, band=20, min_ha=.1):
    """Preliminary connected areas by age band; a forester still reviews the borders."""
    geometry = feature["geometry"]
    with rasterio.open(dataset_path(raster)) as ds:
        g, clipped, window = clipped_window(ds, geometry)
        if window is None:
            raise ValueError("No raster coverage for property")
        data = ds.read(1, window=window, masked=True)
        if data.size > 5_000_000:
            raise ValueError("Property is too large for automatic subdivision at this resolution")
        valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data) & (data.data > 0)
        labels = (data.filled(0) // band + 1).astype("int32")
        groups, remainder = [], g
        for polygon, category in shapes(labels, mask=valid, transform=ds.window_transform(window)):
            part = polygon_parts(shape(polygon).intersection(g))
            if part.is_empty or part.area/10000 < min_ha:
                continue
            groups.append((part, int(category)))
            remainder = remainder.difference(part)
        # Unclassified fragments stay explicit; they are not silently added to known inventory.
        remainder = polygon_parts(remainder)
        if not remainder.is_empty and remainder.area/10000 >= .0001:
            groups.append((remainder, 0))
        if len(groups)>300:
            raise ValueError('More than 300 preliminary stands; use smaller properties or review/generalize the borders')
        result=[]
        for index,(part,category) in enumerate(groups,1):
            geo = transform_geom(ds.crs,'EPSG:4326',mapping(part))
            polys = [geo['coordinates']] if geo['type']=='Polygon' else geo['coordinates']
            if sum(len(r) for p in polys for r in p)>2500:
                raise ValueError('Preliminary border exceeds 2500 points; review and simplify it before importing')
            result.append({"type":"Feature","geometry":geo,"properties":{"number":str(index),"name":f"Vorläufiger Bestand {index}" if category else 'Ungeklärte Restfläche',"notes":"Automatische Abgrenzung nach Raster-Altersklassen. Grenzen, Flächenart und Bewirtschaftung in Lignum prüfen.","land_type":"forest" if category else 'other'}})
        return result


def enrich(features, rasters, year, source, scales=None, zero_nodata=True):
    scales=scales or {}; output=[]
    field_names={"volume":"volume_m3sk_ha","height":"mean_height_m","diameter":"mean_diameter_cm","basal_area":"basal_area_m2_ha","age":"age_years"}
    for feature in features:
        item=json.loads(json.dumps(feature)); props=item.setdefault("properties",{}); geometry=item["geometry"]
        inventory=props.setdefault("inventory",{}); sources=inventory.setdefault("sources",{})
        area=metric_geometry(geometry).area/10000
        props["area_ha"]=round(area,6)
        for kind,field in field_names.items():
            if not rasters.get(kind):
                continue
            metric=read_metric(geometry,rasters[kind],scales.get(kind,1.),zero_nodata or kind=="age")
            if not metric:
                # A refreshed source with no data must not leave a stale value attributed to it.
                inventory.pop(field,None)
                sources.pop(field,None)
                if kind=="volume":
                    inventory.pop("volume_m3sk",None); inventory.pop("stock_area_ha",None)
                    sources.pop('volume_m3sk',None); sources.pop('stock_area_ha',None)
                    for old_year in ('reference_year','projected_to_year'):
                        inventory.pop(old_year,None)
                continue
            inventory[field]=round(metric["mean"] if kind!="age" else round(metric["mean"]),6)
            sources[field]={"name":source,"year":year,"file":Path(rasters[kind].split('!')[0]).name,"area_ha":round(metric["area_ha"],6),"method":"cell-polygon intersection area weighted"}
            if kind=="volume":
                inventory["stock_area_ha"]=round(metric["area_ha"],6)
                inventory["volume_m3sk"]=round(metric["integral_ha"],6)
                inventory.pop('projected_to_year',None)
                if year is not None:
                    inventory['reference_year']=year
                else:
                    inventory.pop('reference_year',None)
        if rasters.get("site_index"):
            metric=read_metric(geometry,rasters["site_index"],scales.get("site_index",1.),True)
            if metric:
                inventory["site_index"]=rasters.get("site_species","T")+str(round(metric["mean"]))
                sources["site_index"]={"name":source,"year":year,"method":"area-weighted raster estimate"}
            else:
                inventory.pop('site_index',None); sources.pop('site_index',None)
        species_keys=("pine","spruce","birch","other")
        if any(rasters.get(k) for k in species_keys):
            metric=read_species(geometry,rasters)
            if metric:
                inventory['species_pct']=metric['shares']
                sources['species_pct']={"name":source,"year":year,"area_ha":round(metric['area_ha'],6),"method":"volume shares on common valid raster cells"}
            else:
                inventory.pop("species_pct",None)
                sources.pop('species_pct',None)
        inventory["source_label"]=source
        output.append(item)
    return {"type":"FeatureCollection","lignum_schema":"forest-stands-v1","features":output}


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--stands',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--year',type=int)
    parser.add_argument('--source',default='Skogsstyrelsen / SLU · Rasterimport')
    parser.add_argument('--zero-is-nodata',action='store_true',default=True,help='Treat 0 as unestimated (default for these forestry rasters)')
    parser.add_argument('--include-zero',action='store_false',dest='zero_is_nodata',help='Only when source metadata explicitly defines 0 as an estimated value')
    parser.add_argument('--auto-stands',action='store_true',help='Preliminary subdivision of one property by age classes; requires --age')
    for key in ['volume','height','diameter','basal-area','age','site-index','pine','spruce','birch','other']:
        parser.add_argument('--'+key)
    parser.add_argument('--height-scale',type=float,default=1.,help='0.1 if source height unit is decimetres')
    parser.add_argument('--site-species',choices=['T','G'],default='T')
    args=parser.parse_args();data=json.loads(args.stands.read_text(encoding='utf-8'))
    features=data['features'] if data['type']=='FeatureCollection' else [data]
    if data.get('crs'):
        raise ValueError('Input must be WGS84 GeoJSON; remove or transform an explicit legacy CRS first')
    if args.auto_stands:
        if len(features)!=1 or not args.age:
            parser.error('--auto-stands requires one property polygon and an age raster')
        features=automatic_stands(features[0],args.age)
    rasters=vars(args)
    result=enrich(features,rasters,args.year,args.source,{'height':args.height_scale},args.zero_is_nodata)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f"{len(result['features'])} stands written to {args.output}")


if __name__=='__main__':
    main()
