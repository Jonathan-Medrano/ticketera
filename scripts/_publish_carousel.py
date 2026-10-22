#!/usr/bin/env python3
"""Wrapper: reads caption file and calls ig_graph.publish_carousel directly.
Usage: python scripts/_publish_carousel.py <image_urls_csv> <caption_file>
"""
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import ig_graph  # noqa: E402

urls_csv   = sys.argv[1]
caption_path = sys.argv[2]

with open(caption_path, encoding="utf-8") as fh:
    caption = fh.read().strip()

class Args:
    image_urls = urls_csv
    caption    = caption  # noqa: E741

ig_graph.publish_carousel(Args())
