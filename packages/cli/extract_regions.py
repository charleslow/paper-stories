#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24.0"]
# ///
"""
Extract text blocks with bounding boxes from a PDF using PyMuPDF.

Usage:
    uv run extract_regions.py <pdf_path> <output_path>

Output: JSON file with text blocks and normalized bounding boxes (0-1 range).
Each block has an ID like "p3_b7" (page 3, block 7), the text content,
and a bbox with normalized coordinates {x0, y0, x1, y1}.
"""

import json
import sys

import fitz  # pymupdf


def extract_regions(pdf_path: str) -> dict:
    doc = fitz.open(pdf_path)
    pages = []
    total_blocks = 0

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        width = page.rect.width
        height = page.rect.height

        # get_text("dict") returns blocks with geometry
        page_data = page.get_text("dict")
        blocks = []

        for block_idx, block in enumerate(page_data.get("blocks", [])):
            # Skip image blocks (type 1), keep text blocks (type 0)
            if block.get("type") != 0:
                continue

            # Extract text from block lines/spans
            text_parts = []
            for line in block.get("lines", []):
                line_text = ""
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                if line_text.strip():
                    text_parts.append(line_text.strip())

            text = "\n".join(text_parts)
            if not text.strip():
                continue

            # Normalize bounding box to 0-1 range
            bbox = block["bbox"]  # (x0, y0, x1, y1) in points
            normalized_bbox = {
                "x0": round(bbox[0] / width, 6),
                "y0": round(bbox[1] / height, 6),
                "x1": round(bbox[2] / width, 6),
                "y1": round(bbox[3] / height, 6),
            }

            block_id = f"p{page_idx}_b{block_idx}"
            blocks.append({
                "id": block_id,
                "bbox": normalized_bbox,
                "text": text,
                "type": "text",
            })
            total_blocks += 1

        pages.append({
            "page": page_idx,
            "width": round(width, 2),
            "height": round(height, 2),
            "blocks": blocks,
        })

    doc.close()

    return {
        "pages": pages,
        "totalPages": len(pages),
        "totalBlocks": total_blocks,
    }


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <pdf_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2]

    result = extract_regions(pdf_path)
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(
        f"Extracted {result['totalBlocks']} text blocks "
        f"from {result['totalPages']} pages"
    )


if __name__ == "__main__":
    main()
