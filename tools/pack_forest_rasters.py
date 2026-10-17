#!/usr/bin/env python3
"""Build small, lossless regional JSON tiles from downloaded GeoTIFF ZIPs.

The phone receives native cells and source metadata, not county archives. No
resampling, interpolation, age extrapolation or fabricated acquisition year.
"""
import argparse
from datetime import date
import hashlib
import itertools
import json
from pathlib import Path
import zipfile

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from forest_rasters import check_dataset, dataset_path


def runs(array):
    return [[int(value), sum(1 for _ in group)]
            for value, group in itertools.groupby(array.ravel().tolist())]


def source_info(item):
    group = item['group']
    name = ('SLU Skogskarta · Trädslag 2018 (Bilder 2017–2019)' if group == 'species2018' else
            'SLU Skogskarta 2015' if group in ('species', 'slu') else
            'Skogliga grunddata – Beståndsmedelålder 2025' if group == 'age' else
            'Skogliga grunddata – Ståndortsindex SIS' if group == 'site' else
            f"Skogliga grunddata · Omdrev {item['cycle']}")
    return {'name': name + ' · SLU / Skogsstyrelsen',
            'year': item.get('year'), 'product_year': item.get('product_year'),
            'file': item['local_file'], 'sha256': item['sha256'],
            'url': item['url'], 'scale': item.get('scale', 1),
            'licence_url': ('https://creativecommons.org/licenses/by/4.0/' if group in ('age','site') else
                            'https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/'),
            'note': item.get('year_note', '')}


def pack(report, directory, output, bounds, tile_size=1000):
    if report.get('errors'):
        raise ValueError('Resolve failed downloads before packaging')
    required = {d['id'] for d in report['datasets'] if d['group'] != 'planning'}
    if len(required) < 29:
        raise ValueError('Expected all 29 forestry raster sources; no partial package is published')
    xmin, ymin, xmax, ymax = bounds
    if not xmin < xmax or not ymin < ymax or any(v % tile_size for v in bounds):
        raise ValueError('Bounds must be ordered and aligned to tile size')
    if (xmax-xmin)*(ymax-ymin) > 400_000_000:
        raise ValueError('Build regional packages of at most 400 square kilometres')
    tiles = {(x, y): {'schema': 'lignum-raster-tile-v1',
                     'bounds': [x, y, x+tile_size, y+tile_size], 'layers': {}}
             for x in range(xmin, xmax, tile_size) for y in range(ymin, ymax, tile_size)}
    sources = {}
    inputs=[(item,directory) for item in report['datasets']]
    supplement=directory/'species2018'/'report.json'
    if supplement.exists():
        extra=json.loads(supplement.read_text())
        if extra.get('errors') or len(extra.get('datasets',[]))!=7:
            raise ValueError('SLU 2018 supplement must contain all seven species maps')
        inputs.extend((item,supplement.parent) for item in extra['datasets'])
    for item,source_directory in inputs:
        if item['group'] == 'planning':
            continue
        archive = source_directory / item['local_file']
        if archive.stat().st_size != item['bytes']:
            raise ValueError(f'{archive.name}: size changed since download')
        members = item['rasters']
        if len(members) != 1:
            raise ValueError(f'{archive.name}: review raster selection before building')
        # One regional window per archive keeps ZIP seeks bounded.
        native_path=str(archive)+'!'+members[0]['name'] if archive.suffix.lower()=='.zip' else str(archive)
        with rasterio.open(dataset_path(native_path)) as ds:
            check_dataset(ds)
            if ds.crs.to_epsg() != 3006:
                raise ValueError('Regional packages require EPSG:3006 native rasters')
            if ds.res[0] != ds.res[1]:
                raise ValueError('Square cells required')
            regional_window = from_bounds(xmin, ymin, xmax, ymax, ds.transform).round_offsets().round_lengths()
            data = ds.read(1, window=regional_window, boundless=True, masked=True)
            origin = ds.window_transform(regional_window)
            raw = data.filled(-1).astype('int32')
            raw[~np.isfinite(data.data) | (data.data < 0)] = -1
            source = source_info(item)
            sources[item['id']] = source
            step = ds.res[0]
            if tile_size % step or abs(origin.c-xmin)>.001 or abs(origin.f-ymax)>.001:
                raise ValueError('Region and tiles must align exactly to each native grid')
            pixels = int(tile_size / step)
            for (x, y), tile in tiles.items():
                col, row = int((x-xmin)/step), int((ymax-y-tile_size)/step)
                part = raw[row:row+pixels, col:col+pixels]
                tile['layers'][item['id']] = {
                    'x': x, 'y': y+tile_size, 'step': step,
                    'width': pixels, 'height': pixels, 'runs': runs(part)}
            print(f"Packed {item['id']}: {int((raw >= 0).sum())} native cells", flush=True)
    output.mkdir(parents=True, exist_ok=True)
    listing = []
    for (x, y), tile in tiles.items():
        raw = json.dumps(tile, ensure_ascii=False, separators=(',', ':')).encode()
        digest = hashlib.sha256(raw).hexdigest()
        filename = f'{x}_{y}-{digest[:12]}.json'
        (output/filename).write_bytes(raw)
        listing.append({'file': filename, 'bounds': tile['bounds'], 'sha256': digest, 'bytes': len(raw)})
    index = {'schema': 'lignum-raster-index-v1', 'name': 'Sarvisvaara und Umgebung',
             'region': report['region'], 'bounds': bounds, 'crs': 'EPSG:3006',
             'built_on': str(date.today()), 'sources': sources, 'tiles': listing,
             'attribution': 'Bearbeitet aus Skogsstyrelsen / SLU: native Rasterzellen regional ausgeschnitten und verlustfrei gepackt.',
             'licences': {'age_and_site': 'https://creativecommons.org/licenses/by/4.0/',
                          'other_sources': 'https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/'},
             'notes': ['Aufnahmejahre variieren. Download- und Produktjahr sind keine Aufnahmejahre.',
                       'Baumarten bevorzugt SLU Trädslag 2018 (Bilder 2017–2019); SLU 2015 ist im nördlichen Norrbotten lückenhaft.',
                       'Alterskarte nach tatsächlichem Waldtyp wählen (65 % Grundflächenanteil); SIS nach standortanzeigender Baumart wählen.',
                       'Bestandsalter 2025 unterschätzt ältere Bestände; Eingriffe nach der Aufnahme sind nicht berücksichtigt.']}
    (output/'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2))
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bounds', nargs=4, type=int, required=True, metavar=('XMIN','YMIN','XMAX','YMAX'))
    args = parser.parse_args()
    report = json.loads((args.downloads/'download-report.json').read_text())
    index = pack(report, args.downloads, args.output, args.bounds)
    print(f"{len(index['tiles'])} tiles written to {args.output}")


if __name__ == '__main__':
    main()
