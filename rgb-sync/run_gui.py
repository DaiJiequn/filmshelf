import sys

from rgbsync.__main__ import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["gui"]))
