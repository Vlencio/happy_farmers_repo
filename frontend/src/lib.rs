use rune::{AppSpec, TextEdit};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;
mod model;
mod season;
mod ui;
use model::{Analysis, Culture, Farm, HistoryItem, Page, Settings};

struct State {
    farm: Option<Farm>,
    history: Vec<HistoryItem>,
    page: Page,
    analysis: Option<Analysis>,
    selected: usize,
    stage: usize,
    crop: Option<String>,
    crop_open: bool,
    cultures: Vec<Culture>,
    settings: Settings,
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
}
impl Default for State {
    fn default() -> Self {
        Self {
            farm: None,
            history: vec![],
            page: Page::Setup,
            analysis: None,
            selected: 0,
            stage: 0,
            crop: None,
            crop_open: false,
            cultures: vec![],
            settings: Settings::default(),
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
        }
    }
}
impl State {
    fn invalidate(&mut self) {
        self.analysis = None;
        self.page = Page::Setup;
        self.selected = 0;
        self.stage = 0;
        self.loading = false;
        self.discarded_open = false;
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
            self.error = "Escolha a cultura para adicionar ao histórico.".into();
            return;
        }
        if !season::valid_season(&season) {
            self.error = "Informe a safra como 2025 ou 2025/26.".into();
            return;
        }
        if self.notes.text.chars().count() > 500 {
            self.error = "Resuma a observação em até 500 caracteres.".into();
            return;
        }
        if self.history.len() >= 12 {
            self.error = "O histórico aceita até 12 registros neste protótipo.".into();
            return;
        }
        if self
            .history
            .iter()
            .any(|item| item.crop == crop && item.season == season)
        {
            self.error = "Essa cultura e safra já estão no histórico.".into();
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
        self.crop_open = false;
        self.month_open = false;
        self.horizon_open = false;
        self.error.clear();
        self.loading = true;
        host(json!({"type":"analyze"}));
    }
    fn select(&mut self, index: usize) {
        self.selected = index;
        self.stage = 0;
        self.page = Page::Timeline;
    }
    fn save_settings(&mut self) {
        self.invalidate();
        self.month_open = false;
        self.horizon_open = false;
        host(json!({"type":"settings", "settings":self.settings}));
    }
    fn crop_label(&self, id: &str) -> String {
        self.cultures
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.label.clone())
            .unwrap_or_else(|| id.into())
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Config {
        ready: bool,
        cultures: Vec<Culture>,
        data_notice: String,
    },
    Farm {
        farm: Farm,
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
    Cancelled,
    Cleared,
}
fn apply_command(s: &mut State, command: Command) {
    match command {
        Command::Config {
            ready,
            cultures,
            data_notice,
        } => {
            s.ready = ready;
            s.cultures = cultures;
            s.data_notice = data_notice;
            if ready {
                s.error.clear();
            }
        }
        Command::Farm { farm } => {
            s.invalidate();
            s.farm = Some(farm);
        }
        Command::Restore {
            farm,
            history,
            settings,
        } => {
            s.farm = farm;
            s.history = history;
            s.settings = settings;
            s.notice = "Seu rascunho foi restaurado neste navegador.".into();
        }
        Command::Analysis { mut analysis } => {
            analysis
                .recommendations
                .sort_by_key(|r| match r.category.as_str() {
                    "income" => 0,
                    "soil" => 1,
                    _ => 2,
                });
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
        Command::Cancelled => {
            s.loading = false;
            s.notice = "Análise cancelada.".into();
        }
        Command::Cleared => {
            let ready = s.ready;
            let cultures = s.cultures.clone();
            let data_notice = s.data_notice.clone();
            *s = State::default();
            s.ready = ready;
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
