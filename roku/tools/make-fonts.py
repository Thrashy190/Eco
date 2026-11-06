#!/usr/bin/env python3
"""Make the two fonts the Roku app uses from Bricolage Grotesque, Eco's display face (SIL Open Font License).

Roku reads plain TrueType files, not variable fonts, so this cuts fixed instances out of the variable font:

    curl -LO "https://github.com/google/fonts/raw/main/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf"
    pip install fonttools
    python3 roku/tools/make-fonts.py "BricolageGrotesque[opsz,wdth,wght].ttf"
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")
# Text sizes on a TV are 22-36 px: optical size 24 for reading, a larger one for titles
STYLES = {"Regular": {"wght": 400, "opsz": 24, "wdth": 100}, "Bold": {"wght": 700, "opsz": 48, "wdth": 100}}


def main(source):
    for name, axes in STYLES.items():
        font = instantiateVariableFont(TTFont(source), axes, updateFontNames=True)
        font.save(os.path.join(OUT, f"BricolageGrotesque-{name}.ttf"))
    print("fonts written to", OUT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
