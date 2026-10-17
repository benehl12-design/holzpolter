#!/usr/bin/env python3
"""Discover and download official forestry ZIPs, without the Skogsstyrelsen API.

catalog --output catalog.json
download --catalog catalog.json --county 25 --destination /data/lignum
download --catalog catalog.json --national --destination /data/lignum

Download selection is explicit. National files and county files are alternatives,
not cumulative copies. A feed entry is not proof that its archive still exists.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import zipfile

INDEX = 'https://www.skogsstyrelsen.se/laddanergeodata'
HOST = 'geodpags.skogsstyrelsen.se'
COUNTIES = {'Stockholm':'01','Uppsala':'03','Södermanland':'04','Östergötland':'05',
    'Jönköping':'06','Kronoberg':'07','Kalmar':'08','Gotland':'09','Blekinge':'10',
    'Skåne':'12','Halland':'13','Västra Götaland':'14','Värmland':'17','Örebro':'18',
    'Västmanland':'19','Dalarna':'20','Gävleborg':'21','Västernorrland':'22',
    'Jämtland':'23','Västerbotten':'24','Norrbotten':'25'}
ATOM = '{http://www.w3.org/2005/Atom}'


def checked_url(url, kind='data'):
    p=urlparse(url)
    if p.scheme!='https' or p.hostname!=HOST or p.username or p.password or p.port not in (None,443):
        raise ValueError('Only official HTTPS download URLs are accepted')
    prefix='/geodataport/'+('feeds/' if kind=='feed' else 'data/')
    if not p.path.startswith(prefix) or '..' in unquote(p.path).split('/') or p.query or p.fragment:
        raise ValueError('Unexpected official download path')
    return p._replace(path=quote(p.path,safe='/%')).geturl()


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    tmp.replace(path)


class IndexLinks(HTMLParser):
    def __init__(self):
        super().__init__();self.href=None;self.label='';self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.href=dict(attrs).get('href');self.label=''
    def handle_data(self,text):
        if self.href:self.label+=text
    def handle_endtag(self,tag):
        if tag=='a' and self.href:
            if '/geodataport/feeds/' in self.href:
                self.links.append({'name':self.label.strip(),'feed':urljoin(INDEX,self.href)})
            self.href=None


def product(link):
    stem=unquote(urlparse(link['feed']).path.rsplit('/',1)[-1]).removesuffix('.xml')
    ascii_stem=unicodedata.normalize('NFKD',stem).encode('ascii','ignore').decode()
    match=re.fullmatch(r'SGD(Volym|Medelhojd|Medeldiameter|Grundyta)_omdrev([123])',ascii_stem)
    if match:
        kind={'Volym':'volume','Medelhojd':'height','Medeldiameter':'diameter','Grundyta':'basal_area'}[match[1]]
        return {'id':kind+'_omdrev'+match[2],'kind':kind,'omdrev':int(match[2]),
                'role':'historical_fallback' if match[2]=='1' else 'core','reference_year':None}
    if ascii_stem.startswith('Alder'):
        return {'id':ascii_stem.lower(),'kind':'age','species_model':ascii_stem[5:],
                'role':'core','reference_year':2025}
    if ascii_stem in ('SISTall','SISGran'):
        return {'id':ascii_stem.lower(),'kind':'site_index','species_model':ascii_stem[3:],
                'role':'core','reference_year':None}
    match=re.fullmatch(r'SLUSkogskarta(Ovrigt|Tall|Gran|Ek|Contorta|Bok|Bjork)?Volym',ascii_stem)
    if match:
        species=match[1] or 'Total'
        return {'id':'slu_'+species.lower(),'kind':'species_volume' if species!='Total' else 'species_total',
                'species_model':species,'role':'core','reference_year':None}
    return None


def parse_feed(data, link):
    spec=product(link)
    if not spec:return None
    root=ET.fromstring(data)
    archives=[];seen=set()
    for node in root.iter(ATOM+'link'):
        if node.get('type')!='application/zip':continue
        url=checked_url(urljoin(link['feed'],node.get('href','')))
        if url in seen:continue
        seen.add(url);title=node.get('title','')
        region_label=title.split(',')[1].strip().casefold() if ',' in title else ''
        region_label=re.sub(r'\s+län$','',region_label)
        county=next((code for name,code in COUNTIES.items() if region_label in (name.casefold(),name.casefold()+'s')),None)
        if county is None and 'rikstäckande' not in title.lower():
            raise ValueError('Cannot determine archive region: '+title)
        archives.append({'url':url,'filename':unquote(urlparse(url).path.rsplit('/',1)[-1]),
                         'county':county,'region':'SE' if county is None else county,'feed_label':title})
    # Use the product name from the index: some feed titles are stale P95 templates.
    return {**spec,**link,'feed_updated':root.findtext(ATOM+'updated'),
        'feed_rights':root.findtext(ATOM+'rights'),'archives':archives}


def discover(workers=4, cache_dir=None):
    with urlopen(INDEX,timeout=30) as response:
        parser=IndexLinks();parser.feed(response.read().decode('utf-8'))
    links=[r for r in parser.links if product(r)]
    cache=Path(cache_dir) if cache_dir else None
    if cache:cache.mkdir(parents=True,exist_ok=True)
    def read(link):
        try:
            checked_url(link['feed'],'feed')
            with urlopen(link['feed'],timeout=30) as response:data=response.read(2_000_001)
            if len(data)>2_000_000:raise ValueError('Unexpected feed size')
            if cache:(cache/(product(link)['id']+'.xml')).write_bytes(data)
            return parse_feed(data,link)
        except (HTTPError,URLError,ValueError,ET.ParseError,TimeoutError) as exc:
            return {**product(link),**link,'archives':[],'error':str(exc)}
    with ThreadPoolExecutor(max_workers=workers) as pool:items=list(pool.map(read,links))
    return {'schema':'lignum-forest-downloads-v1','source':INDEX,'created_at':utcnow(),
            'note':'Feed date/file modification is not the inventory observation year. County suffixes are not years.',
            'products':items}


def selected(catalog, counties=None, national=False, datasets=None, historical=False):
    if bool(counties)==bool(national):raise ValueError('Select county code(s) OR national archives')
    wanted={str(c).zfill(2) for c in counties or []}
    if wanted-set(COUNTIES.values()):raise ValueError('Unknown Swedish county code')
    out=[]
    for p in catalog['products']:
        if p.get('role')=='historical_fallback' and not historical:continue
        if datasets and p['id'] not in datasets:continue
        for a in p.get('archives',[]):
            if (national and a['county'] is None) or (not national and a['county'] in wanted):
                out.append({**a,'dataset_id':p['id'],'dataset_name':p['name'],'kind':p['kind'],
                            'omdrev':p.get('omdrev'),'reference_year':p.get('reference_year')})
    if not out:raise ValueError('No matching official archives in this catalog')
    return out


def probe(entry, timeout=20):
    try:
        with urlopen(Request(checked_url(entry['url']),method='HEAD'),timeout=timeout) as response:
            return {**entry,'status':response.status,'bytes':int(response.headers['Content-Length']) if response.headers.get('Content-Length') else None,
                    'etag':response.headers.get('ETag'),'last_modified':response.headers.get('Last-Modified')}
    except (HTTPError,URLError,TimeoutError) as exc:
        return {**entry,'status':getattr(exc,'code',None),'error':str(exc)}


def verify_zip(path):
    with zipfile.ZipFile(path) as archive:
        members=[{'name':x.filename,'bytes':x.file_size} for x in archive.infolist()]
        bad=archive.testzip()
        if bad:raise ValueError('ZIP CRC check failed: '+bad)
        if not any(x['name'].lower().endswith(('.tif','.tiff')) for x in members):
            raise ValueError('Archive contains no GeoTIFF data')
        return members


def download(entry, destination, opener=urlopen):
    """Publish only complete ZIPs with checked size, CRC and SHA-256 receipts."""
    entry={**entry,'url':checked_url(entry['url'])}
    filename=entry['filename']
    if filename!=Path(filename).name or not filename.lower().endswith('.zip'):
        raise ValueError('Invalid archive filename')
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    final=destination/filename;receipt=final.with_suffix('.receipt.json')
    if final.exists():
        if not receipt.exists():raise ValueError('Existing archive has no verification receipt: '+str(final))
        saved=json.loads(receipt.read_text())
        with final.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
        if saved.get('sha256')!=digest or saved.get('bytes')!=final.stat().st_size:
            raise ValueError('Existing archive differs from its receipt')
        if saved.get('url')!=entry['url'] or (entry.get('etag') and saved.get('etag')!=entry['etag']):
            raise ValueError('Source version changed; retain the old archive separately before refreshing')
        return saved
    free=shutil.disk_usage(destination).free
    if entry.get('bytes',0) and entry['bytes']>free-512*1024*1024:
        raise OSError('Not enough free disk space for this complete archive')
    part=final.with_suffix('.zip.part');partial=final.with_suffix('.partial.json')
    offset=0;headers={}
    if part.exists() and partial.exists() and entry.get('etag'):
        previous=json.loads(partial.read_text())
        if previous.get('etag')==entry['etag'] and previous.get('url')==entry['url']:
            offset=part.stat().st_size;headers={'Range':f'bytes={offset}-','If-Range':entry['etag']}
    with opener(Request(entry['url'],headers=headers),timeout=40) as response:
        status=response.status
        if status not in (200,206):raise ValueError('Unexpected download response '+str(status))
        if offset and status==206:
            if not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                raise ValueError('Incorrect resume byte range')
        else:offset=0
        etag=response.headers.get('ETag')
        if entry.get('etag') and etag and etag!=entry['etag']:
            raise ValueError('Archive changed after size check; refresh the catalog probe')
        atomic_json(partial,{'url':entry['url'],'etag':etag,'started_at':utcnow()})
        h=hashlib.sha256();size=offset
        if offset:
            with part.open('rb') as old:
                while chunk:=old.read(1024*1024):h.update(chunk)
        with part.open('ab' if offset else 'wb') as target:
            while chunk:=response.read(1024*1024):
                target.write(chunk);h.update(chunk);size+=len(chunk)
            target.flush();os.fsync(target.fileno())
        expected=entry.get('bytes')
        if expected is None and response.headers.get('Content-Length'):
            expected=offset+int(response.headers['Content-Length'])
        if expected is not None and size!=expected:raise ValueError('Incomplete archive download')
    members=verify_zip(part)
    result={**entry,'path':str(final.resolve()),'bytes':size,'sha256':h.hexdigest(),
            'etag':etag,'downloaded_at':utcnow(),'crc_verified':True,'members':members}
    atomic_json(receipt,result);part.replace(final);partial.unlink(missing_ok=True)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    commands=parser.add_subparsers(dest='command',required=True)
    cat=commands.add_parser('catalog');cat.add_argument('--output',required=True,type=Path);cat.add_argument('--cache-dir',type=Path)
    for command in ('probe','download'):
        p=commands.add_parser(command);p.add_argument('--catalog',required=True,type=Path)
        group=p.add_mutually_exclusive_group(required=True);group.add_argument('--county',nargs='+');group.add_argument('--national',action='store_true')
        p.add_argument('--datasets',nargs='+');p.add_argument('--include-historical',action='store_true')
        p.add_argument('--output',required=command=='probe',type=Path)
        if command=='download':p.add_argument('--destination',required=True,type=Path)
    args=parser.parse_args()
    if args.command=='catalog':
        data=discover(cache_dir=args.cache_dir);atomic_json(args.output,data)
        errors=[p for p in data['products'] if p.get('error')]
        print(json.dumps({'products':len(data['products']),'feed_errors':len(errors),'output':str(args.output)}))
        return 1 if errors else 0
    catalog=json.loads(args.catalog.read_text());entries=selected(catalog,args.county,args.national,args.datasets,args.include_historical)
    with ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(probe,entries))
    report={'created_at':utcnow(),'archives':checks}
    if args.command=='probe':
        atomic_json(args.output,report)
        print(json.dumps({'archives':len(checks),'available':sum(x['status']==200 for x in checks),'known_bytes':sum(x.get('bytes') or 0 for x in checks)}));return 0
    results=[]
    for entry in checks:
        try:
            if entry['status']!=200:raise ValueError(entry.get('error') or 'Archive unavailable')
            print('Downloading '+entry['filename'],flush=True)
            row=download(entry,args.destination);results.append({'file':entry['filename'],'state':'verified','sha256':row['sha256']})
        except (OSError,ValueError,zipfile.BadZipFile) as exc:
            results.append({'file':entry['filename'],'state':'failed','error':str(exc)})
        atomic_json(args.destination/'download-status.json',{'updated_at':utcnow(),'results':results})
    print(json.dumps(results,ensure_ascii=False));return 1 if any(x['state']=='failed' for x in results) else 0


if __name__=='__main__':
    raise SystemExit(main())
