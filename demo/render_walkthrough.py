"""Render a disclosed, silent screenshot walkthrough; no browser/desktop capture."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
SCREENS = ROOT / 'screens'
FRAMES = ROOT / 'frames'
FRAMES.mkdir(exist_ok=True)
REGULAR = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 40)
TITLE = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 54)
SMALL = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 27)
SUMMARY = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 43)

slides = [
    ('01-start.png', 'A read-only research workspace', 'The API key stays on the local server. Researchers review prices, rules and evidence without trading or connecting a wallet.'),
    ('02-catalog.png', 'Discover markets with Panta pagination', 'The approved live key returned 40 markets across two pages. Catalog rows can omit titles and prices; missing data is shown explicitly.'),
    ('03-detail.png', 'Fetch a market detail on demand', 'This detail returned the Big Brother Naija question, timestamps and independent YES / NO quotes. Prices reflect the captured observation.'),
    ('04-rules.png', 'Make missing resolution wording visible', 'Panta did not return resolution wording for this market. The viewer explains that it cannot assess absent rules or verify the outcome.'),
    ('05-trades.png', 'Inspect the returned trade tape', 'The API returned nine trade records. Amounts are preserved as received, with no guessed unit conversion or complete-history claim.'),
    ('06-search.png', 'Search the pages already loaded', 'A fetched detail title enriches its catalog row. Search applies to loaded markets, including available titles, identifiers and categories.'),
    ('07-comparison.png', 'Compare two observations and export', 'Two fetched markets were exported with mode=live and synthetic=false. Null quotes stay unavailable; observation times remain visible.'),
    (None, 'Verified integration, clear limits', 'This prototype has no claimed customers, revenue or award. Next steps are resolution-metadata validation and research with actual users.'),
]

def wrap(text, draw, font, width):
    lines = []
    line = ''
    for word in text.split():
        candidate = (line + ' ' + word).strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] > width and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines

manifest = {
    'product': 'Resolution Lens', 'capture_date': '2026-09-30',
    'format': 'Silent English-captioned walkthrough made from real browser screenshots, not a continuous screen recording.',
    'source': 'Authorized Panta live-key reads through the local viewer. No credential is in the video.',
    'duration_seconds': 96, 'width': 1920, 'height': 1080, 'fps': 24,
    'published': False, 'slides': [],
}
vtt = ['WEBVTT', '']
for index, (screenshot, title, caption) in enumerate(slides):
    canvas = Image.new('RGB', (1920, 1080), '#edf3f7')
    draw = ImageDraw.Draw(canvas)
    draw.text((62, 27), 'Resolution Lens | Screenshot walkthrough | 2026-09-30', font=SMALL, fill='#3c596b')
    draw.text((62, 72), title, font=TITLE, fill='#173444')
    draw.text((1735, 38), f'{index + 1:02} / 08', font=SMALL, fill='#3c596b')
    if screenshot:
        source = Image.open(SCREENS / screenshot).convert('RGB')
        resized = ImageOps.contain(source, (1840, 715), Image.Resampling.LANCZOS)
        position = ((1920 - resized.width) // 2, 148 + (715 - resized.height) // 2)
        canvas.paste(resized, position)
    else:
        draw.rounded_rectangle((62, 167, 1858, 845), radius=24, fill='white', outline='#d4e1e9', width=2)
        facts = [
            'Authenticated catalog, cursor pagination and filters verified',
            'Detail prices and nine returned trade records inspected',
            'Two-market export verified on disk; 24 automated tests passed',
            'Missing rules, null quotes and old observations stay visible',
            'Built with AI coding assistance; no transaction performed',
        ]
        for row, fact in enumerate(facts):
            draw.ellipse((100, 224 + row * 116, 118, 242 + row * 116), fill='#40788a')
            draw.text((148, 201 + row * 116), fact, font=SUMMARY, fill='#173444')
    lines = wrap(caption, draw, REGULAR, 1796)
    if len(lines) > 3:
        raise ValueError('Caption exceeds the available layout.')
    for row, line in enumerate(lines):
        draw.text((62, 887 + row * 48), line, font=REGULAR, fill='#173444')
    draw.text((62, 1037), 'Captured observations, not current-price guarantees. API fees remain unconfirmed.', font=SMALL, fill='#56707f')
    frame = FRAMES / f'{index + 1:02}.png'
    canvas.save(frame)
    manifest['slides'].append({'screen': screenshot, 'title': title, 'caption': caption, 'start_seconds': index * 12, 'duration_seconds': 12, 'frame_sha256': hashlib.sha256(frame.read_bytes()).hexdigest()})
    start = f'00:{index * 12 // 60:02}:{index * 12 % 60:02}.000'
    end = f'00:{(index + 1) * 12 // 60:02}:{(index + 1) * 12 % 60:02}.000'
    vtt += [f'{start} --> {end}', title, caption, '']

(ROOT / 'walkthrough-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(ROOT / 'walkthrough.vtt').write_text('\n'.join(vtt), encoding='utf-8')
concat = ''.join(f"file '{index + 1:02}.png'\nduration 12\n" for index in range(8)) + "file '08.png'\n"
(FRAMES / 'sequence.txt').write_text(concat, encoding='ascii')
film = ROOT / 'resolution-lens-walkthrough.mp4'
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise RuntimeError('FFmpeg unavailable; rendered frames are preserved.')
command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(FRAMES / 'sequence.txt'), '-vf', 'fps=24,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-t', '96', '-movflags', '+faststart', str(film)]
subprocess.run(command, check=True)
probe = subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'json', str(film)], check=True, capture_output=True, text=True)
metadata = json.loads(probe.stdout)
assert abs(float(metadata['format']['duration']) - 96) < .1
assert metadata['streams'][0]['width'] == 1920
assert metadata['streams'][0]['height'] == 1080
(ROOT / 'walkthrough-video-check.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
print(json.dumps({'video': str(film), 'bytes': film.stat().st_size, 'duration': metadata['format']['duration']}))
