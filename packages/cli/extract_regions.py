# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pymupdf>=1.24.0",
# ]
# ///

"""
Extract text blocks with normalized bounding boxes from a PDF.

Outputs a JSON file mapping each page to its text blocks, each with:
- text: the block's text content
- bbox: normalized coordinates [x0, y0, x1, y1] in range [0, 1]
- page: 0-indexed page number

Usage:
    uv run extract_regions.py <pdf_path> [--output <output.json>]
"""

import argparse
import json
import sys

import pymupdf


def extract_regions(pdf_path: str) -> dict:
    """Extract text blocks with normalized bounding boxes from a PDF."""
    doc = pymupdf.open(pdf_path)
    pages = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        width = page.rect.width
        height = page.rect.height

        if width == 0 or height == 0:
            continue

        blocks = page.get_text("blocks")
        text_blocks = []

        for block in blocks:
            x0, y0, x1, y1, text, block_no, block_type = block

            # Skip image blocks (type 1)
            if block_type != 0:
                continue

            text = text.strip()
            if not text:
                continue

            # Normalize coordinates to [0, 1]
            text_blocks.append({
                "text": text,
                "bbox": [
                    round(x0 / width, 4),
                    round(y0 / height, 4),
                    round(x1 / width, 4),
                    round(y1 / height, 4),
                ],
                "blockIndex": block_no,
            })

        pages.append({
            "page": page_num,
            "width": width,
            "height": height,
            "blocks": text_blocks,
        })

    doc.close()

    return {
        "totalPages": len(doc),
        "pages": pages,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract text regions from PDF")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "-o", "--output", help="Output JSON file path (default: stdout)"
    )
    args = parser.parse_args()

    result = extract_regions(args.pdf_path)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Extracted {sum(len(p['blocks']) for p in result['pages'])} blocks "
              f"from {result['totalPages']} pages -> {args.output}", file=sys.stderr)
    else:
        json.dump(result, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
