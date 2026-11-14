use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Farm {
    pub name: String,
    pub source: String,
    pub geojson: Value,
    pub area_ha: f64,
    pub point_count: usize,
    pub outline: Vec<Vec<[f32; 2]>>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HistoryItem {
    pub crop: String,
    pub season: String,
    pub notes: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Culture {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Settings {
    pub mes_plantio: u8,
    pub horizonte: u8,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            mes_plantio: 10,
            horizonte: 2,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Setup,
    Results,
    Timeline,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Analysis {
    pub demo: bool,
    pub summary: String,
    pub source_warning: String,
    pub scenario_note: String,
    pub recommendations: Vec<Recommendation>,
    pub discarded: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Recommendation {
    pub category: String,
    pub crop: String,
    pub metric: String,
    pub metric_label: String,
    pub reason: String,
    pub tradeoff: String,
    pub facts: Vec<Fact>,
    pub timeline: Vec<Stage>,
    pub month_labels: Vec<String>,
    pub water_caption: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct FieldContext {
    pub summary: String,
    pub coverage: String,
    pub terrain: String,
    pub station: String,
    pub source: String,
    pub model_spread: String,
    pub months: Vec<NdviMonth>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct NdviMonth {
    pub label: String,
    pub value: String,
    pub height: f32,
    pub frequency: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Fact {
    pub label: String,
    pub value: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Stage {
    pub title: String,
    pub period: String,
    pub start_month: u8,
    pub end_month: u8,
    pub description: String,
    pub water: String,
    pub soil: String,
    pub risk: String,
    pub monthly: Vec<Month>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Month {
    pub month: String,
    pub days: String,
    pub kc: String,
    pub rain: String,
    pub demand: String,
    pub deficit: String,
}
