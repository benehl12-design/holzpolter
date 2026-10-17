import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC=importlib.util.spec_from_file_location('forest_restore',Path(__file__).parents[1]/'tools'/'restore_forest_archive.py')
MODULE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.output=self.root/'restored'
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:archive.writestr('source.tif',b'raster bytes'*100)
        self.raw=buffer.getvalue();mid=len(self.raw)//2
        self.manifest={'archive':'source.zip','archive_bytes':len(self.raw),'archive_sha256':hashlib.sha256(self.raw).hexdigest(),'parts':[]}
        for number,data in enumerate((self.raw[:mid],self.raw[mid:]),1):
            name=f'source.zip.{number:03}.bin';(self.root/name).write_bytes(data)
            self.manifest['parts'].append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        self.path=self.root/'source.zip.parts.json';self.write_manifest()

    def write_manifest(self):self.path.write_text(json.dumps(self.manifest))

    def test_reassembles_and_reuses_only_identical_archive(self):
        target=MODULE.restore(self.path,self.output)
        self.assertEqual(target.read_bytes(),self.raw)
        self.assertEqual(MODULE.restore(self.path,self.output),target)
        target.write_bytes(b'unrelated file')
        with self.assertRaisesRegex(ValueError,'different archive'):MODULE.restore(self.path,self.output)
        self.assertEqual(target.read_bytes(),b'unrelated file')

    def test_tampered_part_never_publishes_zip(self):
        part=self.root/self.manifest['parts'][1]['name'];part.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'Part checksum'):MODULE.restore(self.path,self.output)
        self.assertFalse((self.output/'source.zip').exists())
        self.assertFalse((self.output/'source.restore-part').exists())

    def test_manifest_cannot_read_outside_part_directory(self):
        self.manifest['parts'][0]['name']='../other.bin';self.write_manifest()
        with self.assertRaisesRegex(ValueError,'basenames'):MODULE.restore(self.path,self.output)
        self.assertFalse((self.output/'source.zip').exists())

    def test_existing_incomplete_restore_is_preserved(self):
        self.output.mkdir();partial=self.output/'source.restore-part';partial.write_bytes(b'other restore in progress')
        with self.assertRaises(FileExistsError):MODULE.restore(self.path,self.output)
        self.assertEqual(partial.read_bytes(),b'other restore in progress')


if __name__=='__main__':unittest.main()
