#!/usr/bin/env python3
"""Download the public ZIPs named in a reviewed Lignum raster catalogue.

No Skogsstyrelsen API account is used. Originals stay outside the app/repository.
Downloads resume only after the server confirms the requested byte range.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen
import zipfile


def parallel_ranges(url, partial, expected, connections):
    """Parallel byte ranges for the last large archive, with one ordered append.

    Completed prefix and completed range files remain reusable on interruption.
    At most `connections` HTTP requests are active; use one archive worker.
    """
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > expected:
        raise ValueError('Partial file is larger than the source')
    spans = [(start, min(start+32*2**20, expected)-1)
             for start in range(offset, expected, 32*2**20)]

    def retrieve(span):
        start, end = span
        path = partial.with_name(partial.name+f'.range-{start}-{end}')
        length = end-start+1
        if path.exists() and path.stat().st_size == length:
            return path
        for attempt in range(4):
            try:
                headers = {'Range':f'bytes={start}-{end}', 'User-Agent':'Lignum-forest-data/1.0'}
                with urlopen(Request(url, headers=headers), timeout=90) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{expected}':
                        raise ValueError('Server did not confirm the exact requested byte range')
                    with path.open('wb') as stream:
                        while chunk := response.read(2**20):
                            stream.write(chunk)
                if path.stat().st_size != length:
                    raise ValueError('Incomplete byte range')
                return path
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt+1)

    with ThreadPoolExecutor(max_workers=connections) as executor:
        parts = list(executor.map(retrieve, spans))
    with partial.open('ab') as target:
        for path in parts:
            with path.open('rb') as stream:
                while chunk := stream.read(2**20):
                    target.write(chunk)
    if partial.stat().st_size != expected:
        raise ValueError('Assembled archive has the wrong size')
    for path in parts:
        path.unlink()


def download(item, destination, attempts=4, segments=1):
    url = item['url']
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'geodpags.skogsstyrelsen.se':
        raise ValueError('Only the reviewed HTTPS download host is allowed')
    name = unquote(parsed.path.rsplit('/', 1)[-1])
    if not name or Path(name).name != name or not name.lower().endswith('.zip'):
        raise ValueError('Invalid ZIP filename')
    target = destination / name
    partial = target.with_suffix('.zip.part')
    expected = item['bytes']
    if target.exists() and target.stat().st_size != expected:
        raise ValueError(f'{name}: existing file has an unexpected size; inspect it first')
    if not target.exists():
        if segments > 1:
            parallel_ranges(url, partial, expected, segments)
        for attempt in range(attempts):
            try:
                offset = partial.stat().st_size if partial.exists() else 0
                if offset == expected:
                    break
                if offset > expected:
                    raise ValueError('Partial file is larger than the source')
                headers = {'User-Agent': 'Lignum-forest-data/1.0'}
                if offset:
                    headers['Range'] = f'bytes={offset}-'
                with urlopen(Request(url, headers=headers), timeout=90) as response:
                    if offset and response.status == 206:
                        content_range = response.headers.get('Content-Range', '')
                        if not re.fullmatch(rf'bytes {offset}-\d+/{expected}', content_range):
                            raise ValueError('Unexpected Content-Range; refusing to append')
                    elif response.status == 200:
                        offset = 0
                    else:
                        raise ValueError(f'Unexpected HTTP status {response.status}')
                    with partial.open('ab' if offset else 'wb') as out:
                        while chunk := response.read(2**20):
                            out.write(chunk)
                if partial.stat().st_size != expected:
                    raise ValueError(f'Incomplete download: {partial.stat().st_size}/{expected}')
                break
            except Exception:
                if attempt == attempts - 1:
                    raise
                time.sleep(min(attempt + 1, 3))
        with zipfile.ZipFile(partial) as archive:
            if not any(n.lower().endswith(('.tif', '.tiff')) for n in archive.namelist()):
                raise ValueError(f'{name}: no GeoTIFF found')
        partial.rename(target)
    with zipfile.ZipFile(target) as archive:
        members = [dict(name=i.filename, bytes=i.file_size, crc32=f'{i.CRC:08x}')
                   for i in archive.infolist() if i.filename.lower().endswith(('.tif', '.tiff'))]
    digest = hashlib.sha256()
    with target.open('rb') as stream:
        while chunk := stream.read(8 * 2**20):
            digest.update(chunk)
    print(f"OK {name} ({expected / 1e6:.1f} MB)", flush=True)
    return {**item, 'local_file': name, 'sha256': digest.hexdigest(), 'rasters': members}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=3, choices=range(1, 7))
    parser.add_argument('--segments', type=int, choices=(1,6), default=1,
                        help='Use 6 parallel byte ranges for one large remaining archive (requires --workers 1)')
    args = parser.parse_args()
    if args.segments > 1 and args.workers != 1:
        parser.error('--segments 6 requires --workers 1 to bound total connections')
    catalogue = json.loads(args.catalogue.read_text())
    args.destination.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        pending = {executor.submit(download, item, args.destination, segments=args.segments): item for item in catalogue['datasets']}
        for future in as_completed(pending):
            try:
                results.append(future.result())
            except Exception as error:
                item = pending[future]
                errors.append({'id': item['id'], 'error': str(error)})
                print(f"FAILED {item['id']}: {error}", flush=True)
            order = {d['id']: i for i, d in enumerate(catalogue['datasets'])}
            results.sort(key=lambda d: order[d['id']])
            report = {**catalogue, 'datasets': results, 'errors': errors}
            temp = args.destination / 'download-report.json.tmp'
            temp.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            temp.replace(args.destination / 'download-report.json')
    if errors:
        raise SystemExit(f'{len(errors)} download(s) failed; inspect download-report.json')


if __name__ == '__main__':
    main()
