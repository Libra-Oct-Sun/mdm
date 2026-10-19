"""Generate the Mdmuder application icon from code."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/calibrib.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def make_icon(size: int = 1024) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = int(42 * scale)
    radius = int(218 * scale)
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill=(29, 104, 90, 255),
    )

    # A small cinnabar seal echoes the unsaved-state marker in the interface.
    seal_size = int(106 * scale)
    seal_x = size - margin - int(90 * scale) - seal_size
    seal_y = margin + int(82 * scale)
    draw.rounded_rectangle(
        (seal_x, seal_y, seal_x + seal_size, seal_y + seal_size),
        radius=int(15 * scale),
        fill=(164, 61, 46, 255),
    )

    font = load_font(int(548 * scale))
    box = draw.textbbox((0, 0), "M", font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    x = (size - text_width) / 2 - box[0]
    y = (size - text_height) / 2 - box[1] + int(34 * scale)
    draw.text((x, y), "M", font=font, fill=(244, 251, 248, 255))

    return image


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    appicon = make_icon(1024)
    appicon.save(BUILD / "appicon.png")
    appicon.save(
        BUILD / "windows" / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("generated build/appicon.png and build/windows/icon.ico")


if __name__ == "__main__":
    main()
