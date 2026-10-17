import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('download_forest_data', ROOT/'tools/download_forest_data.py')
download = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download)
spec = importlib.util.spec_from_file_location('pack_forest_rasters', ROOT/'tools/pack_forest_rasters.py')
import sys
sys.path.insert(0, str(ROOT/'tools'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class Response(io.BytesIO):
    status = 200
    headers = {}


class Downloads(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('raster.tif', b'Example TIFF bytes; raster decoding is tested separately')
        self.bytes = stream.getvalue()
        self.item = dict(id='volume_2', url='https://geodpags.skogsstyrelsen.se/geodataport/data/test.zip', bytes=len(self.bytes))

    def test_download_records_exact_bytes_hash_and_member_without_extracting(self):
        with patch.object(download, 'urlopen', return_value=Response(self.bytes)):
            item = download.download(self.item, self.path)
        self.assertEqual((self.path/'test.zip').read_bytes(), self.bytes)
        self.assertEqual(item['rasters'][0]['name'], 'raster.tif')
        self.assertEqual(len(item['sha256']), 64)
        self.assertFalse((self.path/'raster.tif').exists())

    def test_resume_requires_matching_content_range(self):
        (self.path/'test.zip.part').write_bytes(self.bytes[:20])
        response = Response(self.bytes[20:])
        response.status = 206
        response.headers = {'Content-Range': f'bytes 20-{len(self.bytes)-1}/{len(self.bytes)}'}
        with patch.object(download, 'urlopen', return_value=response):
            download.download(self.item, self.path)
        self.assertEqual((self.path/'test.zip').read_bytes(), self.bytes)

    def test_server_ignoring_range_restarts_instead_of_appending(self):
        (self.path/'test.zip.part').write_bytes(self.bytes[:20])
        with patch.object(download, 'urlopen', return_value=Response(self.bytes)):
            download.download(self.item, self.path)
        self.assertEqual((self.path/'test.zip').read_bytes(), self.bytes)

    def test_wrong_range_and_unreviewed_host_are_refused(self):
        (self.path/'test.zip.part').write_bytes(self.bytes[:20])
        response = Response(self.bytes[20:]);response.status=206
        response.headers={'Content-Range': 'bytes 0-99/100'}
        with patch.object(download, 'urlopen', return_value=response), self.assertRaisesRegex(ValueError, 'Content-Range'):
            download.download(self.item, self.path, attempts=1)
        with self.assertRaisesRegex(ValueError, 'reviewed'):
            download.download({**self.item, 'url':'https://example.org/a.zip'}, self.path)

    def test_parallel_ranges_resume_the_prefix_and_assemble_exact_bytes(self):
        (self.path/'test.zip.part').write_bytes(self.bytes[:20])
        def response(request, **kwargs):
            start,end=map(int,request.get_header('Range').removeprefix('bytes=').split('-'))
            result=Response(self.bytes[start:end+1]);result.status=206
            result.headers={'Content-Range':f'bytes {start}-{end}/{len(self.bytes)}'}
            return result
        with patch.object(download,'urlopen',side_effect=response):
            download.download(self.item,self.path,segments=6)
        self.assertEqual((self.path/'test.zip').read_bytes(),self.bytes)
        self.assertEqual(list(self.path.glob('*.range-*')),[])

    def test_rle_roundtrip_is_exact_and_source_dates_are_not_invented(self):
        import numpy as np
        values=np.array([[0,0,-1],[4,4,2]],dtype='int16')
        runs=pack.runs(values)
        self.assertEqual([v for v,n in runs for _ in range(n)], values.ravel().tolist())
        s=pack.source_info({**self.item,'group':'age','year':2025,'local_file':'test.zip','sha256':'example'})
        self.assertEqual(s['year'],2025)
        s=pack.source_info({**self.item,'group':'grunddata','cycle':2,'local_file':'test.zip','sha256':'example'})
        self.assertIsNone(s['year'])

    def test_catalogue_contains_all_seven_species_and_only_norrbotten_public_zips(self):
        c=json.loads((ROOT/'data/forest-sources-norrbotten.json').read_text())
        species={x['id'] for x in c['datasets'] if x['group']=='species'}
        self.assertEqual(species, {'species_'+k for k in ('pine','spruce','birch','broadleaf','contorta','oak','beech','total')})
        self.assertTrue(all(d['url'].endswith('25.zip') for d in c['datasets']))
        self.assertEqual(len(c['datasets']),30)

    def test_real_geotiff_zip_builds_lossless_native_tiles_and_rejects_partial_catalogue(self):
        import copy
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        tif=self.path/'native.tif'
        with rasterio.open(tif,'w',driver='GTiff',crs='EPSG:3006',transform=from_origin(780000,7410010,10,10),width=2,height=1,count=1,dtype='int16',nodata=-1) as ds:
            ds.write(np.array([[100,300]],dtype='int16'),1)
        archive=self.path/'native.zip'
        with zipfile.ZipFile(archive,'w') as z:z.write(tif,'native.tif')
        catalogue=json.loads((ROOT/'data/forest-sources-norrbotten.json').read_text())
        items=[{**d,'bytes':archive.stat().st_size,'local_file':'native.zip','sha256':'fixture','rasters':[{'name':'native.tif'}]} for d in catalogue['datasets'] if d['group']!='planning']
        report={'region':'Test','datasets':items,'errors':[]}
        result=pack.pack(report,self.path,self.path/'out',[780000,7410000,780020,7410010],tile_size=10)
        self.assertEqual(len(result['tiles']),2)
        a=json.loads((self.path/'out'/result['tiles'][0]['file']).read_text())
        b=json.loads((self.path/'out'/result['tiles'][1]['file']).read_text())
        self.assertEqual(a['layers']['volume_2']['runs'],[[100,1]])
        self.assertEqual(b['layers']['volume_2']['runs'],[[300,1]])
        self.assertEqual(result['sources']['height_2']['scale'],.1)
        self.assertIsNone(result['sources']['volume_2']['year'])
        report['datasets']=items[:-1]
        with self.assertRaisesRegex(ValueError,'29 forestry'):
            pack.pack(report,self.path,self.path/'bad',[780000,7410000,780020,7410010],tile_size=10)


if __name__=='__main__':
    unittest.main()
