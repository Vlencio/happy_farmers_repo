"""Suggested soil texture for a point, from the delivered GLDAS table (data/solo/regiao_mg/textura.csv).

Local lookup only: no download. The engine takes the texture the farmer confirms (entrada.solo_textura);
this is just the first suggestion shown on screen.
"""
from pathlib import Path

import pandas as pd

TABLE = Path(__file__).resolve().parent.parent / "data" / "solo" / "regiao_mg" / "textura.csv"
HALF_CELL = 0.125  # the table holds 0.25-degree cell centres
NOTE = "Sugestão regional por célula de 0,25°; confirme com o que você conhece do talhão."


class SoilSuggestion:
    def __init__(self, table=TABLE):
        table = Path(table)
        self.cells = pd.read_csv(table) if table.exists() else None

    @property
    def available(self):
        return self.cells is not None

    def get(self, lat, lon):
        """{lat, lon, textura_sugerida, fonte} for the point asked; textura_sugerida None outside the table."""
        found = None
        if self.cells is not None:
            near = self.cells[((self.cells["lat"] - lat).abs() <= HALF_CELL) & ((self.cells["lon"] - lon).abs() <= HALF_CELL)]
            if not near.empty:
                # on a cell edge two cells match: take the closest centre
                found = near.loc[((near["lat"] - lat) ** 2 + (near["lon"] - lon) ** 2).idxmin()]
        if found is None or pd.isna(found["textura"]):
            return {"lat": lat, "lon": lon, "textura_sugerida": None, "fonte": None}
        return {"lat": lat, "lon": lon, "textura_sugerida": str(found["textura"]), "fonte": f"{found['fonte']}. {NOTE}"}
