"""Select delivered regional tables and expose provenance; no climate formulas here."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from scripts.clima_ponto import RAIO_DEMO_KM, clima_por_ponto, distancia_km, mc

ROOT = Path(__file__).resolve().parents[1]
DELTA_PATH = ROOT / "data/nexgddp/regiao_mg/delta_mensal.csv"
BOUNDARY_PATH = Path(__file__).with_name("geo") / "minas_gerais.geojson"


def in_ring(lon, lat, ring):
    """Ray casting, including points on the boundary (coordinates are lon, lat)."""
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cross = (lon - x1) * (y2 - y1) - (lat - y1) * (x2 - x1)
        if abs(cross) < 1e-12 and min(x1, x2) <= lon <= max(x1, x2) and min(y1, y2) <= lat <= max(y1, y2):
            return True
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


class PointClimate:
    def __init__(self, delta_path=DELTA_PATH, boundary_path=BOUNDARY_PATH):
        data = pd.read_csv(delta_path)
        required = ["lat", "lon", "mes", "delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"]
        required += [f"delta_dias_acima_{lim}" for lim in (32, 35, 36, 38)]
        if not set(required) <= set(data.columns) or not np.isfinite(data[required].to_numpy()).all():
            raise ValueError("delta_mensal.csv incompleto ou com valores inválidos")
        self.cells = {}
        for cell, rows in data.groupby(["lat", "lon"], sort=True):
            if len(rows) != 12 or set(rows["mes"]) != set(range(1, 13)):
                raise ValueError(f"delta_mensal.csv: célula {cell} sem 12 meses únicos")
            self.cells[cell] = rows.sort_values("mes").drop(columns=["lat", "lon"]).reset_index(drop=True)
        if not self.cells:
            raise ValueError("delta_mensal.csv vazio")
        self.centers = np.array(list(self.cells))
        self.polygons = []
        for feature in json.loads(Path(boundary_path).read_text(encoding="utf-8"))["features"]:
            geometry = feature["geometry"]
            if geometry["type"] == "Polygon":
                self.polygons.append(geometry["coordinates"])
            elif geometry["type"] == "MultiPolygon":
                self.polygons.extend(geometry["coordinates"])
            else:
                raise ValueError("Malha de Minas Gerais incompatível")
        if not self.polygons:
            raise ValueError("Malha de Minas Gerais vazia")

    def inside_minas(self, lat, lon):
        return any(in_ring(lon, lat, rings[0]) and not any(in_ring(lon, lat, hole) for hole in rings[1:])
                   for rings in self.polygons)

    def select_cell(self, lat, lon):
        # NEX-GDDP cells are 0.25 degrees. Never extrapolate to a distant cell or across missing data.
        offsets = np.abs(self.centers - [lat, lon])
        matches = np.flatnonzero((offsets <= 0.125 + 1e-9).all(axis=1))
        if not len(matches):
            raise ValueError("O ponto do talhão está fora da cobertura climática disponível para Minas Gerais e entorno. "
                             "Selecione uma área dentro da cobertura ou use o talhão de demonstração.")
        index = min(matches, key=lambda i: float((offsets[i] ** 2).sum()))
        cell = tuple(self.centers[index])
        return cell, self.cells[cell]

    def get(self, lat, lon):
        cell, deltas = self.select_cell(lat, lon)
        inside = self.inside_minas(lat, lon)
        if distancia_km(lat, lon, mc.LAT, mc.LON) <= RAIO_DEMO_KM:
            result = clima_por_ponto(lat, lon)
        else:
            result = clima_por_ponto(lat, lon, deltas=deltas, origem_delta="nex_regional")
        origin = dict(result["origem"])
        origin["dentro_mg"] = inside
        warnings = [origin["aviso"]] if origin.get("aviso") else []
        if not inside:
            warnings.append("O ponto do talhão está fora de Minas Gerais na malha simplificada do IBGE. "
                            "O calendário de culturas é do Triângulo Mineiro; este resultado é exploratório.")
        if origin["hoje"] == "tabela_demo":
            warnings.append("Este ponto está a até 25 km do talhão de demonstração. Usamos o clima desse talhão, "
                            "com a correção da estação A520, sem nova consulta ao POWER.")
        if origin["delta"] == "nex_regional":
            origin["celula_nex"] = {"lat": float(cell[0]), "lon": float(cell[1]), "resolucao_graus": 0.25}
            warnings.append("POWER do ponto e projeção NEX-GDDP regional, sem correção da estação A520. "
                            "Os meses de plantio ainda são os do Triângulo Mineiro; valide a adequação local.")
            if lat > -17.1:
                warnings.append("No norte da grade, há extremos de chuva conhecidos nos dados NEX-GDDP "
                                "que podem afetar a receita futura e a ordem de opções próximas.")
        origin["aviso"] = " ".join(warnings) or None
        return {**result, "origem": origin}
