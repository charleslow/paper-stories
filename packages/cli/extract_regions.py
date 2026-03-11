# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pymupdf>=1.24.0",
# ]
# ///

"""
Extract text and image blocks with normalized bounding boxes from a PDF.

Outputs a JSON file mapping each page to its blocks, each with:
- text: the block's text content (text blocks only)
- bbox: normalized coordinates [x0, y0, x1, y1] in range [0, 1]
- page: 0-indexed page number
- type: "text" or "image"

Usage:
    uv run extract_regions.py <pdf_path> [--output <output.json>]
"""

import argparse
import json
import sys

import pymupdf


def extract_regions(pdf_path: str) -> dict:
    """Extract text and image blocks with normalized bounding boxes from a PDF."""
    doc = pymupdf.open(pdf_path)
    pages = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        width = page.rect.width
        height = page.rect.height

        if width == 0 or height == 0:
            continue

        blocks = page.get_text("blocks")
        extracted_blocks = []

        for block in blocks:
            x0, y0, x1, y1, content, block_no, block_type = block

            bbox = [
                round(x0 / width, 4),
                round(y0 / height, 4),
                round(x1 / width, 4),
                round(y1 / height, 4),
            ]

            if block_type == 0:
                # Text block
                text = content.strip()
                if not text:
                    continue
                extracted_blocks.append({
                    "type": "text",
                    "text": text,
                    "bbox": bbox,
                    "blockIndex": block_no,
                })
            elif block_type == 1:
                # Image block — no text content, just the bounding box
                extracted_blocks.append({
                    "type": "image",
                    "bbox": bbox,
                    "blockIndex": block_no,
                })

        pages.append({
            "page": page_num,
            "width": width,
            "height": height,
            "blocks": extracted_blocks,
        })

    total_pages = len(doc)
    doc.close()

    return {
        "totalPages": total_pages,
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
