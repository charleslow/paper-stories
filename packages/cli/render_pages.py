# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pymupdf>=1.24.0",
# ]
# ///

"""
Render PDF pages to PNG images for vision-based analysis.

Used by the --vision flag to generate page images that can be sent to
vision models (e.g., Claude + Grounding DINO) for figure/chart detection.

Usage:
    uv run render_pages.py <pdf_path> --output-dir <dir> [--dpi 150] [--pages 0-5]
"""

import argparse
import os
import sys

import pymupdf


def render_pages(pdf_path: str, output_dir: str, dpi: int = 150, page_range: str | None = None):
    """Render PDF pages to PNG images."""
    doc = pymupdf.open(pdf_path)
    os.makedirs(output_dir, exist_ok=True)

    # Parse page range
    if page_range:
        parts = page_range.split("-")
        if len(parts) == 2:
            start, end = int(parts[0]), int(parts[1])
        else:
            start = end = int(parts[0])
        pages = range(start, min(end + 1, len(doc)))
    else:
        pages = range(len(doc))

    zoom = dpi / 72  # 72 is default PDF DPI
    matrix = pymupdf.Matrix(zoom, zoom)
    rendered = []

    for page_num in pages:
        page = doc[page_num]
        pix = page.get_pixmap(matrix=matrix)
        output_path = os.path.join(output_dir, f"page_{page_num:04d}.png")
        pix.save(output_path)
        rendered.append(output_path)

    doc.close()

    print(f"Rendered {len(rendered)} pages at {dpi} DPI -> {output_dir}", file=sys.stderr)
    return rendered


def main():
    parser = argparse.ArgumentParser(description="Render PDF pages to PNG")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("-o", "--output-dir", required=True, help="Output directory for PNGs")
    parser.add_argument("--dpi", type=int, default=150, help="Resolution (default: 150)")
    parser.add_argument("--pages", help="Page range, e.g., '0-5' or '3' (default: all)")
    args = parser.parse_args()

    render_pages(args.pdf_path, args.output_dir, args.dpi, args.pages)


if __name__ == "__main__":
    main()
