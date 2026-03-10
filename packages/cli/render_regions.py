# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pymupdf>=1.24.0",
# ]
# ///

"""
Render cropped PDF regions for story excerpts as PNG files.

Takes a PDF and a story JSON, finds each excerpt with a pdfRegion,
renders the cropped bounding box from the PDF page, and saves it
as a PNG file in the output directory.

Output files are named by chapter ID: {chapter_id}.png

Usage:
    uv run render_regions.py <pdf_path> <story_json_path> -o <output_dir> [--dpi 150] [--padding 0.02]
"""

import argparse
import json
import os
import sys

import pymupdf


def render_region(doc: pymupdf.Document, page_num: int, bbox: list[float],
                  output_path: str, dpi: int = 150, padding: float = 0.02) -> bool:
    """Render a cropped region of a PDF page to a PNG file.

    Args:
        doc: Open PyMuPDF document.
        page_num: 0-indexed page number.
        bbox: Normalized [x0, y0, x1, y1] in [0, 1].
        output_path: Path to write the PNG file.
        dpi: Render resolution.
        padding: Extra padding around the bbox as a fraction of page dimensions.

    Returns:
        True if the image was written successfully.
    """
    if page_num < 0 or page_num >= len(doc):
        return False

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

    pix.save(output_path)
    return True


def render_all_regions(pdf_path: str, story_path: str, output_dir: str,
                       dpi: int = 150, padding: float = 0.02) -> int:
    """Render cropped PDF regions for all excerpts in a story."""
    with open(story_path) as f:
        story = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    count = 0

    for chapter in story.get("chapters", []):
        chapter_id = chapter.get("id", "")
        for excerpt in chapter.get("excerpts", []):
            region = excerpt.get("pdfRegion")
            if not region:
                continue

            page = region.get("page")
            bbox = region.get("bbox")
            if page is None or not bbox or len(bbox) != 4:
                continue

            out_path = os.path.join(output_dir, f"{chapter_id}.png")
            if render_region(doc, page, bbox, out_path, dpi=dpi, padding=padding):
                count += 1

    doc.close()
    print(f"Rendered {count} region images to {output_dir}", file=sys.stderr)
    return count


def main():
    parser = argparse.ArgumentParser(description="Render cropped PDF regions for story excerpts")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("story_path", help="Path to the story JSON file")
    parser.add_argument("-o", "--output-dir", required=True, help="Output directory for PNG files")
    parser.add_argument("--dpi", type=int, default=150, help="Resolution (default: 150)")
    parser.add_argument("--padding", type=float, default=0.02,
                        help="Padding around bbox as fraction of page (default: 0.02)")
    args = parser.parse_args()

    render_all_regions(args.pdf_path, args.story_path, args.output_dir, args.dpi, args.padding)


if __name__ == "__main__":
    main()
