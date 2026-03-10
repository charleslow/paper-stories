#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24.0"]
# ///
"""
Render PDF pages to PNG images using PyMuPDF.

Usage:
    uv run render_pages.py <pdf_path> <output_dir> [--dpi 150]

Output: PNG files named page_0.png, page_1.png, etc. in the output directory.
Used for vision model analysis of figures, charts, and diagrams.
"""

import os
import sys

import fitz  # pymupdf


def render_pages(pdf_path: str, output_dir: str, dpi: int = 150):
    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=dpi)
        output_path = os.path.join(output_dir, f"page_{page_idx}.png")
        pix.save(output_path)

    page_count = len(doc)
    doc.close()
    return page_count


def main():
    if len(sys.argv) < 3:
        print(
            f"Usage: {sys.argv[0]} <pdf_path> <output_dir> [--dpi 150]",
            file=sys.stderr,
        )
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    dpi = 150

    # Parse optional --dpi flag
    for i, arg in enumerate(sys.argv[3:], start=3):
        if arg == "--dpi" and i + 1 < len(sys.argv):
            dpi = int(sys.argv[i + 1])

    count = render_pages(pdf_path, output_dir, dpi)
    print(f"Rendered {count} pages to {output_dir} at {dpi} DPI")


if __name__ == "__main__":
    main()
