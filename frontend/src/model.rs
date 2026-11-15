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
#[derive(Clone, Copy, Debug)]
pub enum SelectedStrategy {
    Objective(usize),
    Current,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Analysis {
    pub demo: bool,
    pub summary: String,
    pub source_warning: String,
    pub scenario_note: String,
    pub recommendations: Vec<Recommendation>,
    pub current_rotation: CurrentRotation,
    pub discarded: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct CurrentRotation {
    pub status: String,
    pub title: String,
    pub description: String,
    pub strategy: Option<Recommendation>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Recommendation {
    pub category: String,
    pub crop: String,
    pub reason: String,
    pub tradeoff: String,
    pub facts: Vec<Fact>,
    pub comparison_facts: Vec<Fact>,
    pub timeline: Vec<Stage>,
    pub month_labels: Vec<String>,
    pub water_caption: String,
    pub exposure: Option<Exposure>,
    pub warnings: Option<StrategyWarnings>,
    pub benefits: Option<StrategyBenefits>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct StrategyBenefits {
    pub summary: String,
    pub note: String,
    pub items: Vec<StrategyWarning>,
}
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ChatState {
    pub available: bool,
    pub busy: bool,
    pub blocked: bool,
    pub messages: Vec<ChatMessage>,
    pub pending: String,
    pub error: String,
    pub notice: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatMessage {
    pub papel: String,
    pub texto: String,
    pub recusada: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct StrategyWarnings {
    pub summary: String,
    pub note: String,
    pub risks: Vec<StrategyWarning>,
    pub gaps: Vec<StrategyWarning>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct StrategyWarning {
    pub title: String,
    pub context: String,
    pub description: String,
    pub evidence: String,
    pub card_summary: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Exposure {
    pub period: String,
    pub caption: String,
    pub note: String,
    pub erosion_note: String,
    pub card_facts: Vec<Fact>,
    pub facts: Vec<Fact>,
    pub months: Vec<ExposureMonth>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ExposureMonth {
    pub label: String,
    pub month_days: u8,
    pub days: u8,
    pub exposed_days: u8,
    pub rain: String,
    pub exposed_rain: String,
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
