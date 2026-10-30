#!/usr/bin/env python3
"""Builds the compact sky datasets used by the clock from public sources.

Inputs (download once, paths given on the command line):
  stars.8.json   d3-celestial (BSD-3) star catalogue, GeoJSON, mag <= 8
  mw.json        d3-celestial Milky Way isophote outlines (equatorial coords)

Outputs (written to ../data):
  stars.bin      6 bytes/star, sorted brightest first:
                   u16 ra   (0..65535 -> 0..360 deg, J2000)
                   u16 dec  (0..65535 -> -90..+90 deg)
                   u8  mag  ((mag + 2) * 20)
                   u8  bv   ((B-V + 0.5) * 100)
  milkyway.png   1024x512 equirectangular (RA right, Dec up), luminance only

Usage: build-data.py stars.8.json mw.json [max_mag]
"""
import json, struct, sys, os
from PIL import Image, ImageDraw, ImageChops, ImageFilter

stars_path, mw_path = sys.argv[1], sys.argv[2]
max_mag = float(sys.argv[3]) if len(sys.argv) > 3 else 7.5
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

feats = json.load(open(stars_path))['features']
rows = []
for f in feats:
    mag = f['properties']['mag']
    if mag > max_mag:
        continue
    try:
        bv = float(f['properties'].get('bv') or 0.6)
    except ValueError:
        bv = 0.6
    ra, dec = f['geometry']['coordinates']
    rows.append((mag, ra % 360.0, dec, bv))
rows.sort()
with open(os.path.join(out, 'stars.bin'), 'wb') as fh:
    for mag, ra, dec, bv in rows:
        fh.write(struct.pack('<HHBB',
            min(65535, round(ra / 360.0 * 65535)),
            min(65535, round((dec + 90.0) / 180.0 * 65535)),
            max(0, min(255, round((mag + 2.0) * 20))),
            max(0, min(255, round((bv + 0.5) * 100)))))
print('stars:', len(rows))

W, H = 2048, 1024
acc = Image.new('L', (W, H), 0)
for feat in json.load(open(mw_path))['features']:
    # even-odd fill so inner rings punch holes; outlines nest, so levels add up
    mask = Image.new('1', (W, H), 0)
    for poly in feat['geometry']['coordinates']:
        for ring in poly:
            # unwrap longitudes along the ring so it stays continuous, then draw
            # it at -360/0/+360 deg so rings crossing the RA wrap fill correctly
            lons = [ring[0][0]]
            for lon, _ in ring[1:]:
                d = (lon - lons[-1] + 180.0) % 360.0 - 180.0
                lons.append(lons[-1] + d)
            layer = Image.new('1', (W, H), 0)
            winds = abs(lons[-1] - lons[0]) > 180.0
            for shift in (-360.0, 0.0, 360.0):
                pts = [((l + shift) / 360.0 * W, (0.5 - ring[i][1] / 180.0) * H)
                       for i, l in enumerate(lons)]
                if winds:
                    # ring circles the whole sky: fill the area under the curve;
                    # the two such rings XOR to the band between them
                    pts += [(pts[-1][0], H), (pts[0][0], H)]
                ImageDraw.Draw(layer).polygon(pts, fill=1)
            mask = ImageChops.logical_xor(mask, layer)
    acc = ImageChops.add(acc, mask.convert('L').point(lambda v: 51 if v else 0))
acc = acc.filter(ImageFilter.GaussianBlur(9)).resize((1024, 512), Image.LANCZOS)
acc.save(os.path.join(out, 'milkyway.png'), optimize=True)
print('milkyway.png ok')
