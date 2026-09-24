import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
d, out, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(d + '/*.png'))
tw = 270 if fmt == 'vertical' else 384
th = 480 if fmt == 'vertical' else 216
cols = 10 if fmt == 'vertical' else 6
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 26)), (30, 30, 30))
dr = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
except Exception: font = ImageFont.load_default()
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 26)
    sheet.paste(im, (x, y + 26))
    if fmt == 'vertical':  # safe-area guides (top 250 / bottom 400 of 1920)
        s = th / 1920
        dr.line([(x, y + 26 + 250 * s), (x + tw, y + 26 + 250 * s)], fill=(255, 60, 60), width=1)
        dr.line([(x, y + 26 + 1520 * s), (x + tw, y + 26 + 1520 * s)], fill=(255, 60, 60), width=1)
    dr.text((x + 6, y + 3), os.path.basename(f)[:-4] + 's', fill=(255, 255, 255), font=font)
sheet.save(out, quality=88)
print('wrote', out, sheet.size)
