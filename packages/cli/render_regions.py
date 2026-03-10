# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pymupdf>=1.24.0",
# ]
# ///

"""
Render cropped PDF regions for story excerpts as base64 PNGs.

Takes a PDF and a story JSON, finds each excerpt with a pdfRegion,
renders the cropped bounding box from the PDF page, and writes the
base64-encoded PNG into the excerpt's pdfRegionImage field.

Usage:
    uv run render_regions.py <pdf_path> <story_json_path> [-o output_path] [--dpi 150] [--padding 0.02]
"""

import argparse
import base64
import io
import json
import sys

import pymupdf


def render_region(doc: pymupdf.Document, page_num: int, bbox: list[float],
                  dpi: int = 150, padding: float = 0.02) -> str:
    """Render a cropped region of a PDF page as a base64-encoded PNG.

    Args:
        doc: Open PyMuPDF document.
        page_num: 0-indexed page number.
        bbox: Normalized [x0, y0, x1, y1] in [0, 1].
        dpi: Render resolution.
        padding: Extra padding around the bbox as a fraction of page dimensions.

    Returns:
        Base64-encoded PNG string (no data URI prefix).
    """
    if page_num < 0 or page_num >= len(doc):
        return ""

    page = doc[page_num]
    pw, ph = page.rect.width, page.rect.height

    x0, y0, x1, y1 = bbox

    # Add padding, clamped to [0, 1]
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(1, x1 + padding)
    y1 = min(1, y1 + padding)

    # Convert normalized coords to page coords
    clip = pymupdf.Rect(x0 * pw, y0 * ph, x1 * pw, y1 * ph)

    zoom = dpi / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, clip=clip)

    img_bytes = pix.tobytes("png")
    return base64.b64encode(img_bytes).decode("ascii")


def add_region_images(pdf_path: str, story_path: str, output_path: str | None = None,
                      dpi: int = 150, padding: float = 0.02) -> None:
    """Add pdfRegionImage fields to excerpts in a story JSON."""
    with open(story_path) as f:
        story = json.load(f)

    doc = pymupdf.open(pdf_path)
    count = 0

    for chapter in story.get("chapters", []):
        for excerpt in chapter.get("excerpts", []):
            region = excerpt.get("pdfRegion")
            if not region:
                continue

            page = region.get("page")
            bbox = region.get("bbox")
            if page is None or not bbox or len(bbox) != 4:
                continue

            b64 = render_region(doc, page, bbox, dpi=dpi, padding=padding)
            if b64:
                excerpt["pdfRegionImage"] = b64
                count += 1

    doc.close()

    out = output_path or story_path
    with open(out, "w") as f:
        json.dump(story, f, indent=2)

    print(f"Added {count} region images to {out}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Render cropped PDF regions for story excerpts")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("story_path", help="Path to the story JSON file")
    parser.add_argument("-o", "--output", help="Output path (defaults to overwriting story_path)")
    parser.add_argument("--dpi", type=int, default=150, help="Resolution (default: 150)")
    parser.add_argument("--padding", type=float, default=0.02,
                        help="Padding around bbox as fraction of page (default: 0.02)")
    args = parser.parse_args()

    add_region_images(args.pdf_path, args.story_path, args.output, args.dpi, args.padding)


if __name__ == "__main__":
    main()
