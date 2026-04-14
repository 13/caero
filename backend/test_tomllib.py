import tomllib
from pathlib import Path
def get_version():
    with open(Path(__file__).parent / "pyproject.toml", "rb") as f:
        return tomllib.load(f)["project"]["version"]
print(get_version())
