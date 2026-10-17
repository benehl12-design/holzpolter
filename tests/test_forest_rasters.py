"""Small real GeoTIFFs exercise fractional cells, NoData and shared species masks."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('forest_rasters', ROOT / 'tools/forest_rasters.py')
forest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forest)


def polygon(x1=780000, y1=7410000, x2=780020, y2=7410010):
    return transform_geom('EPSG:3006', 'EPSG:4326', {
        'type':'Polygon', 'coordinates':[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]]})


class RasterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def raster(self, name, values, transform=None):
        dest = self.dir / (name + '.tif')
        data = np.array(values, dtype='float32')
        with rasterio.open(dest, 'w', driver='GTiff', width=data.shape[1], height=data.shape[0],
                           count=1, dtype='float32', nodata=-9999, crs='EPSG:3006',
                           transform=transform or from_origin(780000,7410010,10,10)) as ds:
            ds.write(data,1)
        return str(dest)

    def test_fractional_cell_area_and_nodata(self):
        path = self.raster('volume', [[100,300]])
        result = forest.read_metric(polygon(x2=780015), path)
        self.assertAlmostEqual(result['mean'], 500/3, places=4)
        self.assertAlmostEqual(result['area_ha'], .015, places=7)
        self.assertAlmostEqual(result['integral_ha'], 2.5, places=5)
        path = self.raster('missing', [[100,-9999]])
        result = forest.read_metric(polygon(), path)
        self.assertAlmostEqual(result['mean'],100,places=5)
        self.assertAlmostEqual(result['area_ha'],.01,places=6)

    def test_unestimated_zero_is_unknown_unless_explicitly_requested(self):
        path = self.raster('zero', [[0,0]])
        self.assertIsNone(forest.read_metric(polygon(),path))
        self.assertEqual(forest.read_metric(polygon(),path,zero_nodata=False)['mean'],0)

    def test_zip_is_read_without_extracting_files(self):
        path = self.raster('volume', [[100,200]])
        archive = self.dir/'county.zip'
        with zipfile.ZipFile(archive,'w') as z:
            z.write(path,'folder/volume.tif')
        result = forest.read_metric(polygon(), str(archive))
        self.assertAlmostEqual(result['mean'],150,places=4)
        self.assertFalse((self.dir/'folder').exists())

    def test_species_share_common_valid_cells_and_keep_absent_species(self):
        paths = {k:self.raster(k,v) for k,v in {
            'pine':[[100,100]], 'spruce':[[0,-9999]], 'birch':[[0,100]], 'other':[[0,100]]}.items()}
        result = forest.read_species(polygon(), paths)
        self.assertAlmostEqual(result['area_ha'],.01,places=6)
        self.assertEqual(result['shares'],dict(pine=100,spruce=0,birch=0,other=0))
        paths['other']=self.raster('shifted', [[0,100]],from_origin(780005,7410010,10,10))
        with self.assertRaisesRegex(ValueError,'pixel grid'):
            forest.read_species(polygon(),paths)

    def test_enrichment_preserves_stock_year_when_only_age_is_refreshed(self):
        feature={'type':'Feature','geometry':polygon(),'properties':{'inventory':{
            'volume_m3sk_ha':100,'reference_year':2015,'sources':{'volume_m3sk_ha':{'year':2015}}}}}
        output=forest.enrich([feature],{'age':self.raster('age',[[40,60]])},2025,'Official age raster')
        inv=output['features'][0]['properties']['inventory']
        self.assertEqual(inv['reference_year'],2015)
        self.assertEqual(inv['age_years'],50)
        self.assertEqual(inv['sources']['age_years']['year'],2025)

    def test_refresh_with_no_data_removes_stale_metric_and_source(self):
        feature={'type':'Feature','geometry':polygon(),'properties':{'inventory':{
            'volume_m3sk_ha':100,'volume_m3sk':2,'stock_area_ha':.02,'reference_year':2015,
            'sources':{'volume_m3sk_ha':{'year':2015}}}}}
        output=forest.enrich([feature],{'volume':self.raster('missing',[[-9999,0]])},2025,'New source')
        inv=output['features'][0]['properties']['inventory']
        self.assertNotIn('volume_m3sk_ha',inv)
        self.assertNotIn('reference_year',inv)
        self.assertNotIn('volume_m3sk_ha',inv['sources'])

    def test_height_scale_and_volume_coverage_use_explicit_units(self):
        feature={'type':'Feature','geometry':polygon(),'properties':{}}
        output=forest.enrich([feature],{'volume':self.raster('v',[[200,-9999]]),
            'height':self.raster('h',[[170,190]])},2022,'Test',{'height':.1})
        inv=output['features'][0]['properties']['inventory']
        self.assertAlmostEqual(inv['volume_m3sk'],2,places=4)
        self.assertAlmostEqual(inv['stock_area_ha'],.01,places=6)
        self.assertAlmostEqual(inv['mean_height_m'],18,places=5)

    def test_automatic_subdivision_retains_uncovered_property_as_unknown(self):
        g=polygon(x2=780080,y2=7410040)
        paths=self.raster('age',np.full((4,4),50),from_origin(780000,7410040,10,10))
        features=forest.automatic_stands({'type':'Feature','geometry':g,'properties':{}},paths)
        unknown=[f for f in features if f['properties']['land_type']=='other']
        self.assertEqual(len(unknown),1)
        parts=[forest.metric_geometry(f['geometry']) for f in features]
        self.assertAlmostEqual(sum(p.area for p in parts),forest.metric_geometry(g).area,places=3)
        self.assertAlmostEqual(parts[0].intersection(parts[-1]).area,0,places=3)


if __name__=='__main__':
    unittest.main()
