from pathlib import Path
import subprocess
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "slides"
PDFTOPPM = Path(r"C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1111-570-0_26.1111.570.0_x64__3k8sg7r9htsxt\dependencies\native\poppler\Library\bin\pdftoppm.exe")

if len(sys.argv) != 2:
    raise SystemExit("Usage: python render_from_pdf.py <print-to-PDF file>")
source = Path(sys.argv[1]).resolve()
if not source.is_file():
    raise SystemExit(f"PDF not found: {source}")

subprocess.run([str(PDFTOPPM), "-png", "-r", "96", "-f", "1", "-l", "5", str(source), str(OUT / "render")], check=True)
for index in range(1, 6):
    generated = OUT / f"render-{index}.png"
    target = OUT / f"slide-{index:02}.png"
    if not generated.is_file():
        raise RuntimeError(f"PDF page {index} was not rendered")
    with Image.open(generated) as im:
        if im.size != (1080, 1350):
            raise RuntimeError(f"PDF page {index} rendered at {im.size}; expected (1080, 1350). Check Edge print scale and paper size.")
        im.save(target, optimize=True)
    generated.unlink()

thumb_w, thumb_h, gap = 324, 405, 20
preview = Image.new("RGB", (thumb_w * 2 + gap * 3, thumb_h * 3 + gap * 4), "#080b0d")
for index in range(1, 6):
    with Image.open(OUT / f"slide-{index:02}.png") as im:
        im = im.convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        slot = index - 1
        preview.paste(im, (gap + (slot % 2) * (thumb_w + gap), gap + (slot // 2) * (thumb_h + gap)))
preview.save(ROOT / "preview.png", optimize=True)
print("Rendered five 1080x1350 PNG slides and preview.png")
