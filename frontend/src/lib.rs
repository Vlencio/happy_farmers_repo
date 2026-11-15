use rune::{AppSpec, TextEdit};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;
mod model;
mod season;
mod ui;
use model::{
    Adjustment, Analysis, ChatState, Culture, Farm, FieldContext, HistoryItem, Page,
    SelectedStrategy, Settings, SoilContext, SoilTexture,
};

struct State {
    farm: Option<Farm>,
    farm_preview: rune::Pixels,
    preview_note: String,
    field_context: Option<FieldContext>,
    field_open: bool,
    glossary_open: bool,
    about_open: bool,
    priorities_open: bool,
    soil_open: bool,
    scenario_open: bool,
    parameters_open: bool,
    history: Vec<HistoryItem>,
    page: Page,
    analysis: Option<Analysis>,
    selected: SelectedStrategy,
    stage: usize,
    exposure_month: usize,
    crop: Option<String>,
    crop_open: bool,
    cultures: Vec<Culture>,
    settings: Settings,
    scenario_available: bool,
    soil_available: bool,
    soil_context: SoilContext,
    adjustment_preview: Option<Adjustment>,
    month_open: bool,
    horizon_open: bool,
    discarded_open: bool,
    data_notice: String,
    season: TextEdit,
    notes: TextEdit,
    error: String,
    notice: String,
    loading: bool,
    ready: bool,
    clear_confirm: bool,
    chat: ChatState,
    chat_open: bool,
    chat_question: TextEdit,
    chat_at_bottom: bool,
}
impl Default for State {
    fn default() -> Self {
        Self {
            farm: None,
            farm_preview: rune::Pixels::new(),
            preview_note: "Loading satellite imagery…".into(),
            field_context: None,
            field_open: true,
            glossary_open: false,
            about_open: false,
            priorities_open: true,
            soil_open: false,
            scenario_open: false,
            parameters_open: false,
            history: vec![],
            page: Page::Setup,
            analysis: None,
            selected: SelectedStrategy::Ranked(0),
            stage: 0,
            exposure_month: 0,
            crop: None,
            crop_open: false,
            cultures: vec![],
            settings: Settings::default(),
            scenario_available: false,
            soil_available: false,
            soil_context: SoilContext::default(),
            adjustment_preview: None,
            month_open: false,
            horizon_open: false,
            discarded_open: false,
            data_notice: String::new(),
            season: TextEdit::new(""),
            notes: TextEdit::new(""),
            error: String::new(),
            notice: String::new(),
            loading: false,
            ready: false,
            clear_confirm: false,
            chat: ChatState::default(),
            chat_open: false,
            chat_question: TextEdit::new(""),
            chat_at_bottom: true,
        }
    }
}
impl State {
    fn reset_chat(&mut self) {
        self.chat = ChatState {
            available: self.chat.available,
            ..ChatState::default()
        };
        self.chat_question.clear();
        self.chat_open = false;
        self.chat_at_bottom = true;
    }
    fn ask_chat(&mut self) {
        if !self.chat.available || self.chat.busy || self.chat.blocked || self.analysis.is_none() {
            return;
        }
        let question = self.chat_question.text.trim().to_owned();
        if question.is_empty() || question.chars().count() > 1000 {
            self.chat.error = "Enter a question of up to 1,000 characters.".into();
            return;
        }
        host(json!({"type":"chat_send", "pergunta":question}));
    }
    fn invalidate(&mut self) {
        self.reset_chat();
        self.analysis = None;
        self.page = Page::Setup;
        self.selected = SelectedStrategy::Ranked(0);
        self.stage = 0;
        self.exposure_month = 0;
        self.loading = false;
        self.discarded_open = false;
        self.adjustment_preview = None;
        self.error.clear();
    }
    fn save_history(&mut self) {
        self.invalidate();
        host(json!({"type": "history", "history": self.history}));
    }
    fn add_history(&mut self) {
        let crop = self
            .cultures
            .iter()
            .find(|c| Some(c.label.as_str()) == self.crop.as_deref())
            .map(|c| c.id.clone())
            .unwrap_or_default();
        let season = self.season.text.trim().to_owned();
        if crop.is_empty() || crop.chars().count() > 80 {
            self.error = "Choose a crop to add to the history.".into();
            return;
        }
        if !season::valid_season(&season) {
            self.error = "Enter a season as 2025 or 2025/26.".into();
            return;
        }
        if self.notes.text.chars().count() > 500 {
            self.error = "Keep your note to 500 characters or fewer.".into();
            return;
        }
        if self.history.len() >= 12 {
            self.error = "This prototype supports up to 12 history entries.".into();
            return;
        }
        if self
            .history
            .iter()
            .any(|item| item.crop == crop && item.season == season)
        {
            self.error = "This crop and season are already in the history.".into();
            return;
        }
        self.history.push(HistoryItem {
            crop,
            season,
            notes: self.notes.text.trim().into(),
        });
        self.season.clear();
        self.notes.clear();
        self.save_history();
    }
    fn analyze(&mut self) {
        if self.farm.is_none() || self.loading || !self.ready {
            return;
        }
        if self.adjustment_blocked() {
            self.error = "Your saved scenario has adjustments this server does not support. Reset the climate to run an analysis.".into();
            return;
        }
        if self.soil_blocked() {
            self.error = "The saved soil texture is unavailable for this analysis. Use the default reference to continue.".into();
            return;
        }
        self.crop_open = false;
        self.month_open = false;
        self.horizon_open = false;
        self.error.clear();
        self.loading = true;
        if self.page == Page::Setup {
            self.parameters_open = false;
        }
        self.reset_chat();
        host(json!({"type":"analyze"}));
    }
    fn select(&mut self, strategy: SelectedStrategy) {
        self.selected = strategy;
        self.stage = 0;
        self.exposure_month = 0;
        self.page = Page::Timeline;
    }
    fn save_settings(&mut self) {
        self.invalidate();
        self.month_open = false;
        self.horizon_open = false;
        host(json!({"type":"settings", "settings":self.settings}));
    }
    fn set_priority(&mut self, index: usize, value: u8) {
        if value > 3 {
            return;
        }
        let priority = match index {
            0 => &mut self.settings.prioridades.agua,
            1 => &mut self.settings.prioridades.solo,
            _ => &mut self.settings.prioridades.renda,
        };
        if *priority == value {
            return;
        }
        *priority = value;
        let reanalyze = self.page != Page::Setup || self.loading;
        self.invalidate();
        if reanalyze
            && self.ready
            && self.farm.is_some()
            && !self.adjustment_blocked()
            && !self.soil_blocked()
        {
            self.page = Page::Results;
            self.loading = true;
        }
        host(json!({"type":"priorities", "settings":self.settings, "analyze":self.loading}));
    }
    fn adjustment_blocked(&self) -> bool {
        !self.scenario_available && self.settings.ajuste.active()
    }
    fn reset_parameters(&mut self) {
        if self.loading {
            return;
        }
        let reanalyze = self.page != Page::Setup && self.ready && self.farm.is_some();
        let defaults = Settings::default();
        self.settings.prioridades = defaults.prioridades;
        self.settings.ajuste = defaults.ajuste;
        self.settings.solo_textura = None;
        // Explicitly use the reference instead of reapplying an automatic suggestion.
        self.settings.solo_padrao = true;
        self.invalidate();
        if reanalyze {
            self.page = Page::Results;
            self.loading = true;
        }
        host(json!({"type":"reset_parameters", "settings":self.settings, "analyze":self.loading}));
    }
    fn soil_blocked(&self) -> bool {
        !self.soil_available && self.settings.solo_textura.is_some()
    }
    fn set_soil(&mut self, texture: Option<SoilTexture>) {
        if texture.is_some() && !self.soil_available {
            return;
        }
        let reanalyze = self.page != Page::Setup || self.loading;
        self.settings.solo_textura = texture;
        self.settings.solo_padrao = texture.is_none();
        self.invalidate();
        if reanalyze && self.ready && self.farm.is_some() && !self.adjustment_blocked() {
            self.page = Page::Results;
            self.loading = true;
        }
        host(json!({"type":"soil", "settings":self.settings, "analyze":self.loading}));
    }
    fn save_adjustment(&mut self, adjustment: Adjustment) {
        self.adjustment_preview = None;
        if adjustment == self.settings.ajuste {
            return;
        }
        let was_results = self.page != Page::Setup || self.loading;
        self.settings.ajuste = adjustment;
        self.invalidate();
        if was_results {
            self.page = Page::Results;
        }
        host(json!({"type":"scenario", "settings":self.settings}));
    }
    fn change_adjustment(&mut self, field: usize, value: f64) {
        if !self.scenario_available || !value.is_finite() {
            return;
        }
        let mut adjustment = self.settings.ajuste;
        if field == 0 {
            adjustment.chuva_pct = value.clamp(-50.0, 30.0);
        } else {
            adjustment.temp_c = value.clamp(0.0, 4.0);
        }
        self.save_adjustment(adjustment);
    }
    fn step_adjustment(&mut self, field: usize, steps: i32) {
        let (value, step) = if field == 0 {
            (self.settings.ajuste.chuva_pct, 5.0)
        } else {
            (self.settings.ajuste.temp_c, 0.5)
        };
        self.change_adjustment(field, (value / step + steps as f64).round() * step);
    }
    fn crop_label(&self, id: &str) -> String {
        self.cultures
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.label.clone())
            .unwrap_or_else(|| {
                match id {
                    "soja" => "Soybean",
                    "milho" => "Corn",
                    "sorgo" => "Sorghum",
                    "feijao" => "Common bean",
                    "girassol" => "Sunflower",
                    "algodao" => "Cotton",
                    "trigo" => "Wheat",
                    "milheto" => "Pearl millet",
                    "braquiaria" => "Brachiaria",
                    "crotalaria" => "Sunn hemp",
                    _ => id,
                }
                .into()
            })
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Soil {
        context: SoilContext,
        texture: Option<SoilTexture>,
        use_default: bool,
    },
    Chat {
        chat: ChatState,
        clear_question: bool,
    },
    Config {
        ready: bool,
        cultures: Vec<Culture>,
        data_notice: String,
        #[serde(default)]
        scenario_available: bool,
        #[serde(default)]
        soil_available: bool,
    },
    Farm {
        farm: Farm,
    },
    FieldContext {
        context: Option<FieldContext>,
    },
    Restore {
        farm: Option<Farm>,
        history: Vec<HistoryItem>,
        settings: Settings,
    },
    Analysis {
        analysis: Analysis,
    },
    Error {
        message: String,
    },
    Notice {
        message: String,
    },
    PreviewNote {
        message: String,
    },
    Cancelled,
    Cleared,
}
fn apply_command(s: &mut State, command: Command) {
    match command {
        Command::Soil {
            context,
            texture,
            use_default,
        } => {
            if s.settings.solo_textura != texture {
                s.invalidate();
            }
            s.soil_context = context;
            s.settings.solo_textura = texture;
            s.settings.solo_padrao = use_default;
        }
        Command::Chat {
            chat,
            clear_question,
        } => {
            if clear_question {
                s.chat_question.clear();
            }
            if !chat.available || s.analysis.is_none() {
                s.chat_open = false;
            }
            s.chat = chat;
        }
        Command::Config {
            ready,
            cultures,
            data_notice,
            scenario_available,
            soil_available,
        } => {
            s.ready = ready;
            s.scenario_available = scenario_available;
            s.soil_available = soil_available;
            s.cultures = cultures;
            s.data_notice = data_notice;
            if ready {
                s.error.clear();
            }
        }
        Command::Farm { farm } => {
            s.invalidate();
            s.farm = Some(farm);
            s.farm_preview = rune::Pixels::new();
            s.preview_note = "Loading satellite imagery…".into();
            s.field_context = None;
        }
        Command::FieldContext { context } => s.field_context = context,
        Command::Restore {
            farm,
            history,
            settings,
        } => {
            s.farm = farm;
            s.history = history;
            s.settings = settings;
            s.notice = "Your draft was restored from this browser.".into();
        }
        Command::Analysis { analysis } => {
            s.loading = false;
            s.error.clear();
            s.analysis = Some(analysis);
            s.page = Page::Results;
        }
        Command::Error { message } => {
            s.loading = false;
            s.error = message;
        }
        Command::Notice { message } => s.notice = message,
        Command::PreviewNote { message } => s.preview_note = message,
        Command::Cancelled => {
            s.loading = false;
            s.notice = "Analysis canceled.".into();
        }
        Command::Cleared => {
            let ready = s.ready;
            let chat_available = s.chat.available;
            let scenario_available = s.scenario_available;
            let soil_available = s.soil_available;
            let cultures = s.cultures.clone();
            let data_notice = s.data_notice.clone();
            *s = State::default();
            s.ready = ready;
            s.chat.available = chat_available;
            s.scenario_available = scenario_available;
            s.soil_available = soil_available;
            s.cultures = cultures;
            s.data_notice = data_notice;
        }
    }
}
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = happyFarmersHost, js_name = action)]
    fn browser_action(json: &str);
}
fn host(value: Value) {
    #[cfg(target_arch = "wasm32")]
    browser_action(&value.to_string());
    #[cfg(not(target_arch = "wasm32"))]
    let _ = value;
}
thread_local! { static HANDLE: RefCell<Option<rune::AppHandle<State>>> = const { RefCell::new(None) }; }
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn receive_command(raw: String) -> Result<(), wasm_bindgen::JsValue> {
    let command = serde_json::from_str::<Command>(&raw)
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))?;
    HANDLE.with(|slot| {
        if let Some(handle) = slot.borrow().as_ref() {
            handle.update(move |s, _| apply_command(s, command));
        }
    });
    Ok(())
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn receive_farm_preview(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    note: String,
) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 1024
        || height > 512
        || rgba.len() != width as usize * height as usize * 4
    {
        return Err("Invalid map preview dimensions.".into());
    }
    HANDLE.with(|slot| {
        if let Some(handle) = slot.borrow().as_ref() {
            handle.update(move |s, _| {
                if s.farm.is_some() {
                    s.farm_preview.set(width, height, rgba);
                    s.preview_note = note;
                }
            });
        }
    });
    Ok(())
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(start))]
pub fn start() {
    let app = rune::App::new(AppSpec::new(
        "Happy Farmers",
        (1440.0, 900.0),
        State::default,
        ui::view,
    ))
    .canvas_id("rune-app")
    .full_viewport();
    HANDLE.with(|slot| *slot.borrow_mut() = Some(app.handle()));
    app.run();
}
