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
    pub recommendations: Vec<Recommendation>,
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
}
