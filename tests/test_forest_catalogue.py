import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('forest_downloads_catalogue',Path(__file__).resolve().parents[1]/'tools/forest_downloads.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
BASE='https://geodpags.skogsstyrelsen.se/geodataport/'
class Response(io.BytesIO):
    def __init__(self,data,status=200,headers=None):super().__init__(data);self.status=status;self.headers=headers or {}
class CatalogueTests(unittest.TestCase):
    def test_region_and_product_come_from_labels_not_numbered_filenames(self):
        link={'name':'Beståndsmedelålder 2025 Tall','feed':BASE+'feeds/AlderTall.xml'}
        data=f'''<feed xmlns="http://www.w3.org/2005/Atom"><title>Stale SIS title</title>
          <link type="application/zip" href="{BASE}data/sks_AlderTall25.zip" title="P95, Norrbottens län, raster"/>
          <link type="application/zip" href="{BASE}data/sks_AlderTall04.zip" title="P95, Södermanlands, raster"/>
          <link type="application/zip" href="{BASE}data/sks_AlderTall.zip" title="P95, rikstäckande, raster"/></feed>'''
        p=f.parse_feed(data,link);self.assertEqual(p['kind'],'age');self.assertEqual(p['name'],link['name']);self.assertEqual(p['reference_year'],2025)
        self.assertEqual([a['county'] for a in p['archives']],['25','04',None]);self.assertEqual(len(f.selected({'products':[p]},['25'])),1)
    def test_unicode_urls_are_encoded_and_other_origins_rejected(self):
        self.assertIn('Medelh%C3%B6jd',f.checked_url(BASE+'data/sks_Medelhöjd.zip'))
        for url in ['http://geodpags.skogsstyrelsen.se/geodataport/data/a.zip','https://evil.test/a.zip',BASE+'data/../feeds/a.zip',BASE+'data/a.zip?token=secret']:
            with self.assertRaises(ValueError):f.checked_url(url)
    def test_region_is_required_and_historical_data_is_opt_in(self):
        p={'id':'v1','role':'historical_fallback','name':'old','kind':'volume','archives':[{'county':'25'}]}
        with self.assertRaises(ValueError):f.selected({'products':[p]},['25'])
        with self.assertRaises(ValueError):f.selected({'products':[p]})
        self.assertEqual(len(f.selected({'products':[p]},['25'],historical=True)),1)
    def test_zip_is_validated_and_receipt_prevents_silent_overwrite(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w') as z:z.writestr('volume.tif',b'II*\x00test')
        data=b.getvalue();entry={'url':BASE+'data/test.zip','filename':'test.zip','bytes':len(data),'etag':'"v1"'};calls=[]
        def opener(req,timeout):calls.append(req);return Response(data,headers={'ETag':'"v1"'})
        with tempfile.TemporaryDirectory() as folder:
            first=f.download(entry,folder,opener);self.assertTrue(first['crc_verified']);self.assertEqual(f.download(entry,folder,opener)['sha256'],first['sha256']);self.assertEqual(len(calls),1)
            Path(folder,'test.zip').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'differs'):f.download(entry,folder,opener)
    def test_incomplete_zip_never_publishes_a_finished_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            entry={'url':BASE+'data/test.zip','filename':'test.zip','bytes':500}
            with self.assertRaises(ValueError):f.download(entry,folder,lambda req,timeout:Response(b'partial'))
            self.assertFalse(Path(folder,'test.zip').exists());self.assertFalse(Path(folder,'test.receipt.json').exists())
    def test_resume_validates_start_and_reuses_only_matching_etag(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w') as z:z.writestr('volume.tif',b'x'*100)
        data=b.getvalue();entry={'url':BASE+'data/test.zip','filename':'test.zip','bytes':len(data),'etag':'"v1"'}
        with tempfile.TemporaryDirectory() as folder:
            Path(folder,'test.zip.part').write_bytes(data[:50]);Path(folder,'test.partial.json').write_text(json.dumps({'url':entry['url'],'etag':'"v1"'}))
            def opener(req,timeout):
                self.assertEqual(req.get_header('Range'),'bytes=50-');return Response(data[50:],206,{'Content-Range':f'bytes 50-{len(data)-1}/{len(data)}','ETag':'"v1"'})
            self.assertEqual(f.download(entry,folder,opener)['bytes'],len(data))
if __name__=='__main__':unittest.main()
