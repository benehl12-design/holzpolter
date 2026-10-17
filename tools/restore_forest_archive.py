#!/usr/bin/env python3
"""Reassemble a large official ZIP retained in checked parts; never overwrite different data."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def basename(value):
    if not isinstance(value,str) or not value or value!=Path(value).name or value in ('.','..') or '\\' in value:
        raise ValueError('Manifest filenames must be plain basenames')
    return value


def restore(manifest_path,destination):
    manifest_path=Path(manifest_path);m=json.loads(manifest_path.read_text())
    name=basename(m['archive']);expected=m['archive_sha256'];size=m['archive_bytes']
    if not name.lower().endswith('.zip') or not re.fullmatch('[0-9a-f]{64}',expected) or not isinstance(size,int) or size<1:
        raise ValueError('Invalid archive manifest')
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True);target=destination/name
    if target.exists():
        with target.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
        if actual!=expected or target.stat().st_size!=size:raise ValueError('Destination contains a different archive')
        return target
    partial=target.with_suffix('.restore-part');total=0;whole=hashlib.sha256();seen=set();created=False
    try:
        with partial.open('xb') as output:
            created=True
            for part in m['parts']:
                partname=basename(part['name'])
                if partname in seen:raise ValueError('Duplicate part')
                seen.add(partname);digest=hashlib.sha256();count=0
                with (manifest_path.parent/partname).open('rb') as source:
                    while block:=source.read(1024*1024):
                        output.write(block);whole.update(block);digest.update(block);count+=len(block);total+=len(block)
                if count!=part['bytes'] or digest.hexdigest()!=part['sha256']:raise ValueError('Part checksum failed: '+partname)
        if total!=size or whole.hexdigest()!=expected:raise ValueError('Complete archive checksum failed')
        with zipfile.ZipFile(partial) as archive:
            bad=archive.testzip()
            if bad:raise ValueError('Archive CRC failed: '+bad)
        partial.replace(target);return target
    except Exception:
        if created:partial.unlink(missing_ok=True)
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True);parser.add_argument('--destination',type=Path,required=True)
    args=parser.parse_args();print(restore(args.manifest,args.destination))
