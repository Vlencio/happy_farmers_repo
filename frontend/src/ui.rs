use crate::{
    State, host,
    model::{
        Adjustment, Analysis, CurrentRotation, Farm, Page, Recommendation, SelectedStrategy,
        SoilTexture, StrategyWarning,
    },
};
use rune::{
    Color, Curve, Cx, Easing, El, ScrollSpec, Shape, TextStyle, canvas, col, el, row, text,
};
use rune_kit::{
    Button, ButtonVariant, Card, ControlSize, Kit, PaletteSeed, ScrollBar, ScrollBarStyle, Select,
    SelectAppearance, TextArea, TextInput,
};
use serde_json::json;

const BG: &str = "#f5f5ee";
const INK: &str = "#193d30";
const MUTED: &str = "#68766a";
const LINE: &str = "#e0e6da";
const MONTHS: &[&str] = &[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const HORIZONS: &[&str] = &["Next crop", "Next two crops"];

fn color(value: &str) -> Color {
    rune::color::hex(value).expect("static palette color")
}
fn label(value: impl Into<String>, size: f32, weight: f32, ink: &str) -> El {
    text(value)
        .font(TextStyle::new(size, weight))
        .color(color(ink))
}
fn paragraph(value: impl Into<String>) -> El {
    label(value, 14.0, 400.0, MUTED).wrap().w_full()
}
fn eyebrow(value: impl Into<String>) -> El {
    label(value, 10.0, 600.0, MUTED).font(TextStyle::new(10.0, 600.0).tracking(1.2))
}
fn panel() -> El {
    col()
        .gap(18.0)
        .padding(24.0)
        .radius(16.0)
        .fill(Color::WHITE)
        .border(1.0, color(LINE))
}
fn rule() -> El {
    el().w_full().h(1.0).fill(color(LINE))
}
fn pill(value: &str, bg: &str, ink: &str) -> El {
    el().px(11.0)
        .py(6.0)
        .radius(20.0)
        .fill(color(bg))
        .child(label(value, 10.0, 600.0, ink))
}
fn button(
    k: &Kit,
    id: &str,
    title: &str,
    primary: bool,
    action: impl Fn(&mut State) + 'static,
) -> El {
    Button::new(title)
        .variant(if primary {
            ButtonVariant::Contrast
        } else {
            ButtonVariant::Outline
        })
        .control_size(ControlSize::ExtraLarge)
        .on_press(action)
        .build(k)
        .key(id)
        .h(44.0)
}
fn responsive_row(narrow: bool) -> El {
    if narrow {
        col().gap(16.0).w_full()
    } else {
        row().gap(20.0).w_full().items_stretch()
    }
}
fn column_width(node: El, narrow: bool, fraction: f32) -> El {
    if narrow {
        node.w_full()
    } else {
        node.w(0.0).min_w(0.0).grow(fraction)
    }
}

fn presentation_context(s: &State, k: &Kit, include_revenue: bool) -> El {
    let mut view = col()
        .key("presentation-context")
        .w_full()
        .gap(10.0)
        .padding(14.0)
        .radius(12.0)
        .fill(color("#edf2e5"))
        .child(
            row()
                .w_full()
                .min_h(44.0)
                .gap(12.0)
                .center_y()
                .child(
                    col()
                        .w(0.0)
                        .min_w(0.0)
                        .grow(1.0)
                        .gap(5.0)
                        .child(
                            label("Demonstration in Minas Gerais, Brazil.", 13.0, 600.0, INK)
                                .wrap()
                                .w_full(),
                        )
                        .child(
                            label(
                                "Metric units · ha · mm · °C · m  /  Brazilian reais (BRL)",
                                11.0,
                                400.0,
                                MUTED,
                            )
                            .wrap()
                            .w_full(),
                        ),
                )
                .child(
                    el().key("about-toggle")
                        .size(44.0, 44.0)
                        .radius(9.0)
                        .center()
                        .fill(color("#e2ead8"))
                        .hover(color(INK).alpha(0.06))
                        .press(color(INK).alpha(0.10))
                        .child(label(
                            if s.about_open { "−" } else { "+" },
                            24.0,
                            500.0,
                            INK,
                        ))
                        .role("button")
                        .label(format!(
                            "About this analysis · {}",
                            if s.about_open { "collapse" } else { "expand" }
                        ))
                        .expanded(s.about_open)
                        .focusable(true)
                        .on_press(|s: &mut State| s.about_open = !s.about_open),
                ),
        );
    if !s.data_notice.is_empty() {
        view = view.child(
            label(
                s.data_notice.split(". ").next().unwrap_or(&s.data_notice),
                11.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    }
    if include_revenue {
        view = view.child(
            label(
                "Revenue is gross, before costs. It is not profit.",
                12.0,
                500.0,
                INK,
            )
            .wrap()
            .w_full(),
        );
    }
    if s.page != Page::Setup && s.farm.is_some() && s.field_context.is_none() {
        view = view.child(label("Vegetation and terrain observations are available only for the demonstration field boundary. These data are not yet available for this field.", 12.0, 400.0, MUTED).wrap().w_full());
    }
    if s.about_open {
        view = view
            .child(rule())
            .child(paragraph("Planting calendars follow the Triângulo Mineiro region; crop prices reflect Brazilian conditions."))
            .child(label("Metric units: hectares (ha), millimeters (mm), degrees Celsius (°C) and meters (m). Currency: Brazilian reais (BRL).", 12.0, 400.0, MUTED).wrap().w_full());
        if include_revenue {
            view = view.child(label("READING REVENUE", 11.0, 600.0, INK))
                .child(paragraph("Full rotation covers all crops in the planned sequence. Per year means revenue per year of field occupancy and is used by the income priority. Values labeled / ha are per hectare; field totals cover the whole boundary."));
        }
        if s.page == Page::Setup {
            view = view.child(
                label(
                    if s.data_notice.is_empty() {
                        "Connect to the analysis service to load the crop catalog and data sources."
                    } else {
                        &s.data_notice
                    },
                    12.0,
                    400.0,
                    MUTED,
                )
                .wrap()
                .w_full(),
            );
        }
    }
    view.child(glossary(s, k))
}

fn disclosure(id: &str, title: &str, open: bool, action: impl Fn(&mut State) + 'static) -> El {
    row()
        .key(id)
        .radius(8.0)
        .hover(color(INK).alpha(0.06))
        .press(color(INK).alpha(0.10))
        .w_full()
        .min_h(44.0)
        .gap(12.0)
        .center_y()
        .child(
            label(title, 19.0, 600.0, INK)
                .wrap()
                .w(0.0)
                .min_w(0.0)
                .grow(1.0),
        )
        .child(label(if open { "−" } else { "+" }, 25.0, 500.0, INK))
        .role("button")
        .label(format!(
            "{title} · {}",
            if open { "collapse" } else { "expand" }
        ))
        .expanded(open)
        .focusable(true)
        .on_press(action)
}

fn local_information(s: &State, k: &Kit, narrow: bool) -> El {
    col()
        .key("local-information")
        .w_full()
        .gap(16.0)
        .child(
            label("04  Tell us more about your field", 19.0, 600.0, INK)
                .wrap()
                .w_full(),
        )
        .child(eyebrow("LOCAL INFORMATION"))
        .child(priorities_panel(s, k, narrow))
        .child(soil_panel(s, k, narrow))
        .child(scenario_panel(s, k, narrow))
}

fn parameters_panel(s: &State, k: &Kit, narrow: bool, analysis: Option<&Analysis>) -> El {
    let mut view = panel()
        .key("analysis-parameters")
        .w_full()
        .child(disclosure(
            "parameters-toggle",
            "Adjust priorities, soil and climate",
            s.parameters_open,
            |s| s.parameters_open = !s.parameters_open,
        ));
    if s.parameters_open {
        if let Some(analysis) = analysis {
            view = view
                .child(paragraph(&analysis.priority_note))
                .child(paragraph(&analysis.scenario_note))
                .child(if analysis.soil_note.is_empty() {
                    el()
                } else {
                    paragraph(&analysis.soil_note)
                })
                .child(if analysis.ranking_note.is_empty() {
                    el()
                } else {
                    paragraph(&analysis.ranking_note)
                });
        }
        view = view
            .child(priorities_panel(s, k, narrow))
            .child(soil_panel(s, k, narrow))
            .child(scenario_panel(s, k, narrow))
            .child(
                Button::new("Reset parameters")
                    .variant(ButtonVariant::Outline)
                    .disabled(s.loading || !s.ready || s.farm.is_none())
                    .on_press(State::reset_parameters)
                    .build(k)
                    .key("reset-parameters")
                    .h(44.0)
                    .w_full(),
            );
    }
    view
}

fn another_field(k: &Kit) -> El {
    button(k, "another-field", "Analyze another field", false, |s| {
        s.clear_confirm = true
    })
    .w_full()
}

fn logo(compact: bool) -> El {
    row()
        .gap(10.0)
        .center_y()
        .child(
            el().size(36.0, 36.0)
                .radius(11.0)
                .fill(color("#d8e9aa"))
                .center()
                .child(label("hf", 23.0, 600.0, INK)),
        )
        .child(
            col()
                .gap(2.0)
                .child(label(
                    "Happy Farmers",
                    if compact { 16.0 } else { 17.0 },
                    600.0,
                    "#ffffff",
                ))
                .child(label("GROW POSSIBILITIES", 8.0, 500.0, "#b4c7ae")),
        )
}
fn sidebar(s: &State, _: &Kit) -> El {
    let dark = Kit::from_palette(PaletteSeed {
        bg: color(INK),
        fg: color("#eef3e4"),
        accent: color("#d8e9aa"),
    });
    let nav = |id: &str, number: &str, title: &str, active: bool, enabled: bool, page: Page| {
        row()
            .key(id)
            .gap(11.0)
            .center_y()
            .px(14.0)
            .h(48.0)
            .radius(9.0)
            .fill(color(if active { "#315440" } else { INK }))
            .hover(Color::WHITE.alpha(if enabled { 0.08 } else { 0.0 }))
            .press(Color::WHITE.alpha(if enabled { 0.14 } else { 0.0 }))
            .child(label(
                number,
                11.0,
                500.0,
                if active { "#d8e9aa" } else { "#8da18f" },
            ))
            .child(label(
                title,
                13.0,
                500.0,
                if enabled { "#f3f6e9" } else { "#8da18f" },
            ))
            .role("button")
            .label(title)
            .disabled(!enabled)
            .focusable(enabled)
            .on_press(move |s: &mut State| {
                if enabled {
                    s.page = page;
                    s.crop_open = false;
                }
            })
    };
    col()
        .w(224.0)
        .h_full()
        .padding(22.0)
        .gap(30.0)
        .fill(color(INK))
        .child(logo(false))
        .child(
            col()
                .gap(7.0)
                .pt(25.0)
                .child(label("YOUR PLAN", 9.0, 600.0, "#9cb299").mb(9.0))
                .child(nav(
                    "nav-farm",
                    "01",
                    "Your farm",
                    s.page == Page::Setup,
                    true,
                    Page::Setup,
                ))
                .child(nav(
                    "nav-results",
                    "02",
                    "Your options",
                    s.page != Page::Setup,
                    s.analysis.is_some(),
                    Page::Results,
                )),
        )
        .child(el().grow(1.0))
        .child(
            col()
                .gap(12.0)
                .padding(16.0)
                .radius(12.0)
                .fill(color("#264734"))
                .child(
                    label(
                        "Your next cycle\nstarts with a\ngood choice.",
                        19.0,
                        500.0,
                        "#e0ebcb",
                    )
                    .wrap(),
                )
                .child(
                    label(
                        "Income, soil and climate.\nThree perspectives on your farm.",
                        11.0,
                        400.0,
                        "#b5c7ad",
                    )
                    .wrap(),
                ),
        )
        .child(
            col()
                .gap(6.0)
                .child(label("NASA SPACE APPS 2026", 9.0, 600.0, "#b4c7ae"))
                .child(label(
                    "Field Shift · Prototype v0.1",
                    10.0,
                    400.0,
                    "#8fa58e",
                )),
        )
        .child(
            Button::new("Analyze another field")
                .variant(ButtonVariant::Ghost)
                .on_press(|s: &mut State| {
                    s.clear_confirm = true;
                })
                .build(&dark)
                .key("reset")
                .h(40.0)
                .color(color("#c5d4bf")),
        )
}
fn header(s: &State, narrow: bool) -> El {
    let mode = if s.ready {
        "Engine connected"
    } else {
        "Engine disconnected"
    };
    let head = if narrow {
        logo(true)
    } else {
        row().gap(10.0).center_y().child(label(
            match s.page {
                Page::Setup => "Your farm / Plan your next cycle",
                Page::Results => "Your options / Compare crop rotations",
                Page::Timeline => "Your options / Explore the crop cycle",
            },
            13.0,
            500.0,
            INK,
        ))
    };
    row()
        .w_full()
        .h(if narrow { 76.0 } else { 72.0 })
        .px(if narrow { 18.0 } else { 36.0 })
        .center_y()
        .justify_between()
        .fill(color(if narrow { INK } else { BG }))
        .child(head)
        .child(pill(
            if narrow {
                if s.ready { "Connected" } else { "Disconnected" }
            } else {
                mode
            },
            if s.ready { "#e1ebd4" } else { "#efe8ce" },
            if s.ready { INK } else { "#75622f" },
        ))
}
fn heading(title: &str, subtitle: &str, narrow: bool) -> El {
    heading_with_width(title, subtitle, narrow, false)
}
fn heading_with_width(title: &str, subtitle: &str, narrow: bool, full_width: bool) -> El {
    col()
        .gap(8.0)
        .child(eyebrow("FARM PLANNING"))
        .child(
            label(title, if narrow { 30.0 } else { 39.0 }, 600.0, INK)
                .font(TextStyle::new(if narrow { 30.0 } else { 39.0 }, 600.0).tracking(-0.6))
                .role("heading")
                .level(1)
                .wrap()
                .w_full(),
        )
        .child(if full_width {
            paragraph(subtitle)
        } else {
            paragraph(subtitle).max_w(780.0)
        })
}
fn steps(s: &State, narrow: bool) -> El {
    let labels = if narrow {
        ["Field", "History", "Planting", "Local info", "Options"]
    } else {
        [
            "Select your field",
            "Add crop history",
            "Plan your next planting",
            "Tell us about your field",
            "Explore your options",
        ]
    };
    let mut line = row().w_full().gap(if narrow { 6.0 } else { 16.0 });
    for (i, title) in labels.iter().enumerate() {
        let active = if s.page == Page::Setup { i < 4 } else { i == 4 };
        let item = if narrow {
            col().center().gap(5.0)
        } else {
            row().center_y().gap(8.0)
        };
        line = line.child(
            item.w(0.0)
                .grow(1.0)
                .min_w(0.0)
                .pb(14.0)
                .child(
                    el().size(25.0, 25.0)
                        .radius(13.0)
                        .center()
                        .fill(color(if active { "#dbe8bd" } else { "#e8ebdf" }))
                        .child(label(format!("{:02}", i + 1), 10.0, 600.0, INK)),
                )
                .child(
                    label(
                        *title,
                        if narrow { 10.0 } else { 12.0 },
                        500.0,
                        if active { INK } else { MUTED },
                    )
                    .wrap()
                    .shrink(),
                ),
        );
    }
    col().gap(0.0).child(line).child(rule())
}
fn field_art(farm: Option<&Farm>) -> El {
    let mut shape = Shape::new();
    if let Some(farm) = farm {
        for ring in &farm.outline {
            shape = shape.fill(ring.clone(), color("#d9e7b7")).stroke(
                ring.clone(),
                2.0,
                color("#527a42"),
            );
        }
    } else {
        let fields = [
            vec![
                [30., 25.],
                [145., 15.],
                [127., 83.],
                [15., 101.],
                [30., 25.],
            ],
            vec![
                [155., 15.],
                [284., 38.],
                [290., 98.],
                [138., 83.],
                [155., 15.],
            ],
            vec![
                [15., 113.],
                [128., 95.],
                [146., 148.],
                [49., 143.],
                [15., 113.],
            ],
            vec![
                [141., 97.],
                [294., 110.],
                [269., 146.],
                [157., 148.],
                [141., 97.],
            ],
        ];
        for (i, field) in fields.iter().enumerate() {
            shape = shape
                .fill(
                    field.clone(),
                    color(if i % 2 == 0 { "#dce6c9" } else { "#e9ecd9" }),
                )
                .stroke(field.clone(), 1.0, color("#a6ba92"));
        }
    }
    el().w_full()
        .h(148.0)
        .fill(color("#f1f4e9"))
        .radius(10.0)
        .center()
        .child(
            canvas(shape.view_box(320.0, 160.0))
                .w_full()
                .max_w(296.0)
                .aspect_ratio(2.0)
                .label("Farm boundary preview"),
        )
}
fn farm_panel(s: &State, k: &Kit, narrow: bool) -> El {
    let mut content = panel().child(
        row()
            .center_y()
            .justify_between()
            .gap(8.0)
            .child(
                label("01  Select your field", 19.0, 600.0, INK)
                    .wrap()
                    .shrink(),
            )
            .child(pill(
                if s.farm.is_some() {
                    "Field defined"
                } else {
                    "First step"
                },
                "#eff3e6",
                "#55713e",
            )),
    );
    if let Some(farm) = &s.farm {
        let mut preview = el()
            .key("farm-satellite-preview")
            .w_full()
            .h(if narrow { 220.0 } else { 240.0 })
            .radius(10.0)
            .fill(color("#e7ecdd"))
            .role("img")
            .label(format!(
                "Satellite map showing the boundary of {}",
                farm.name
            ))
            .on_layout_tx(|_: &mut State, [_, _, width, height], tx| {
                host(json!({"type":"preview_size", "width":width, "height":height}));
                tx.live_only();
            });
        if s.farm_preview.size().0 > 0 {
            preview = preview.pixels_fit(&s.farm_preview, rune::SurfaceFit::Fit);
        } else {
            preview = preview.center().child(field_art(Some(farm)));
        }
        let mut satellite = col().w_full().gap(6.0).child(preview).child(
            label(
                "Imagery © Esri, Vantor, Earthstar Geographics and the GIS community",
                9.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
        if !s.preview_note.is_empty() {
            satellite = satellite.child(label(&s.preview_note, 11.0, 400.0, MUTED).wrap().w_full());
        }
        content = content.child(satellite);
    }
    if let Some(farm) = &s.farm {
        let stacked = narrow || farm.name.chars().count() > 36;
        content = content.child(responsive_row(stacked).gap(14.0).center_y().justify_between()
            .child(column_width(col().gap(5.0).child(label(&farm.name, 19.0, 600.0, INK).wrap().w_full())
                .child(label(format!("{} vertices · {}", farm.point_count, match farm.source.as_str() { "sample" => "sample field", "import" => "imported GeoJSON", _ => "drawn boundary" }), 11.0, 400.0, MUTED).wrap().w_full()), stacked, 1.0))
            .child(col().gap(3.0).child(label(format!("{:.2} ha", farm.area_ha).to_owned(), 26.0, 500.0, INK)).child(label("approximate area · hectares", 10.0, 400.0, MUTED))))
            .child(paragraph("The boundary center provides the latitude and longitude for the analysis. Area converts revenue per hectare into total revenue."))
            .child(responsive_row(narrow)
                .child(column_width(button(k, "edit-map", "View and edit on map", false, |_| host(json!({"type":"map"}))), narrow, 1.0))
                .child(column_width(button(k, "download", "Download GeoJSON", false, |_| host(json!({"type":"download"}))), narrow, 1.0)))
            .child(Button::new("Import another GeoJSON").variant(ButtonVariant::Ghost).on_press(|_: &mut State| host(json!({"type":"import"}))).build(k).key("replace-import").h(40.0));
    } else {
        content = content
            .child(label("Your field is the starting point.", 20.0, 500.0, INK).wrap())
            .child(paragraph(
                "Draw its boundary on the satellite map or use a GeoJSON file you already have.",
            ))
            .child(
                responsive_row(narrow)
                    .child(column_width(
                        button(k, "draw-map", "Draw on map", true, |_| {
                            host(json!({"type":"map"}))
                        }),
                        narrow,
                        1.0,
                    ))
                    .child(column_width(
                        button(k, "import", "Import GeoJSON", false, |_| {
                            host(json!({"type":"import"}))
                        }),
                        narrow,
                        1.0,
                    )),
            )
            .child(label("Polygon or MultiPolygon · up to 2 MB", 10.0, 400.0, MUTED).wrap())
            .child(col().w_full().gap(8.0).padding(14.0).radius(12.0).fill(color("#edf2e5"))
                .child(label("Just exploring? Start here.", 14.0, 600.0, INK).wrap().w_full())
                .child(label("Try a ready-to-use field in Minas Gerais, Brazil. You can review its boundary before analyzing.", 12.0, 400.0, MUTED).wrap().w_full())
                .child(Button::new("Use sample field")
                    .variant(ButtonVariant::Outline)
                    .on_press(|_: &mut State| host(json!({"type":"sample"})))
                    .build(k).key("sample").h(44.0).w_full()));
    }
    column_width(content, narrow, 1.35)
}
fn history_panel(s: &State, k: &Kit, overlays: &mut Vec<El>, narrow: bool) -> El {
    let crops: Vec<String> = s.cultures.iter().map(|c| c.label.clone()).collect();
    let crop = Select::new("crop-select", &crops)
        .appearance(SelectAppearance::Field)
        .placeholder("Select a crop")
        .label("Previous crop")
        .current(s.crop.as_deref())
        .open(s.crop_open)
        .on_toggle(|s: &mut State| {
            s.crop_open = !s.crop_open;
            s.month_open = false;
            s.horizon_open = false;
        })
        .on_close(|s: &mut State| s.crop_open = false)
        .on_choose(|s: &mut State, value, _| {
            s.crop = Some(value.into());
            s.crop_open = false;
        })
        .build(k, overlays)
        .w_full()
        .h(44.0);
    let mut content = panel().gap(14.0)
        .child(row().center_y().justify_between().child(label("02  Your field's history: what has been planted?", 18.0, 600.0, INK).wrap().shrink())
            .child(pill("Optional", "#f0f1ea", MUTED)))
        .child(paragraph("Add one crop at a time, from oldest to newest. You can add several seasons, or continue without a history."))
        .child(label("Seasons and notes stay in your draft; the analysis receives only the crop order.", 11.0, 400.0, MUTED).wrap().w_full())
        .child(col().gap(6.0).child(eyebrow("PREVIOUS CROP")).child(crop));
    content = content
        .child(
            col().gap(6.0).child(eyebrow("SEASON / YEAR")).child(
                TextInput::new(&s.season)
                    .placeholder("e.g. 2025/26")
                    .label("Season or year")
                    .width(None)
                    .height(44.0)
                    .on_edit(|s: &mut State| &mut s.season)
                    .build(k)
                    .key("season")
                    .w_full(),
            ),
        )
        .child(
            col().gap(6.0).child(eyebrow("OPTIONAL NOTE")).child(
                TextInput::new(&s.notes)
                    .placeholder("e.g. little rain near the end of the cycle")
                    .label("Season notes")
                    .width(None)
                    .height(44.0)
                    .on_edit(|s: &mut State| &mut s.notes)
                    .build(k)
                    .key("notes")
                    .w_full(),
            ),
        )
        .child(
            button(
                k,
                "add-history",
                "+ Add to history",
                false,
                State::add_history,
            )
            .w_full(),
        );
    if !s.history.is_empty() {
        content = content.child(rule());
        for (i, item) in s.history.iter().enumerate() {
            let mut info = col().grow(1.0).min_w(0.0).gap(4.0).child(
                label(
                    format!(
                        "{}. {} · {}{}",
                        i + 1,
                        s.crop_label(&item.crop),
                        item.season,
                        if i + 1 == s.history.len() {
                            " · most recent"
                        } else {
                            ""
                        }
                    ),
                    13.0,
                    500.0,
                    INK,
                )
                .wrap(),
            );
            if !item.notes.is_empty() {
                info = info.child(label(&item.notes, 11.0, 400.0, MUTED).wrap().w_full());
            }
            content = content.child(
                row()
                    .key(format!("history-{i}"))
                    .gap(8.0)
                    .center_y()
                    .child(info)
                    .child(
                        Button::new("↑")
                            .variant(ButtonVariant::Ghost)
                            .disabled(i == 0)
                            .on_press(move |s: &mut State| {
                                if i > 0 && i < s.history.len() {
                                    s.history.swap(i, i - 1);
                                    s.save_history();
                                }
                            })
                            .build(k)
                            .key(format!("history-up-{i}"))
                            .label("Move crop earlier")
                            .h(40.0),
                    )
                    .child(
                        Button::new("↓")
                            .variant(ButtonVariant::Ghost)
                            .disabled(i + 1 == s.history.len())
                            .on_press(move |s: &mut State| {
                                if i + 1 < s.history.len() {
                                    s.history.swap(i, i + 1);
                                    s.save_history();
                                }
                            })
                            .build(k)
                            .key(format!("history-down-{i}"))
                            .label("Move crop later")
                            .h(40.0),
                    )
                    .child(
                        Button::new("Remove")
                            .variant(ButtonVariant::Ghost)
                            .on_press(move |s: &mut State| {
                                if i < s.history.len() {
                                    s.history.remove(i);
                                    s.save_history();
                                }
                            })
                            .build(k)
                            .key(format!("remove-{i}"))
                            .h(40.0),
                    ),
            );
        }
    } else {
        content = content.child(
            label(
                "No entries. You can continue without them.",
                11.0,
                400.0,
                MUTED,
            )
            .wrap(),
        );
    }
    column_width(content, narrow, 1.0)
}
fn setup_view(s: &State, k: &Kit, overlays: &mut Vec<El>, narrow: bool) -> El {
    // Each input card follows its own content height, including long histories.
    let input_row = if narrow {
        responsive_row(true)
    } else {
        responsive_row(false).items_start()
    };
    let mut view = col().w_full().gap(22.0)
        .child(heading("What will your next crop cycle be?", "Start with your farm. Then explore ways to grow crops, care for the soil and adapt to a changing climate.", narrow))
        .child(presentation_context(s, k, false))
        .child(steps(s, narrow))
        .child(input_row.child(farm_panel(s, k, narrow)).child(history_panel(s, k, overlays, narrow)))
        .child(planning_panel(s, k, overlays, narrow));
    view = view.child(local_information(s, k, narrow));
    let action = Button::new(if s.loading {
        "Analyzing…"
    } else {
        "Analyze farm  →"
    })
    .variant(ButtonVariant::Contrast)
    .control_size(ControlSize::ExtraLarge)
    .disabled(
        s.farm.is_none() || s.loading || !s.ready || s.adjustment_blocked() || s.soil_blocked(),
    )
    .on_press(State::analyze)
    .build(k)
    .key("analyze")
    .h(58.0)
    .w_full();
    let summary = if s.loading {
        "Calculating your options"
    } else if !s.ready {
        "Connect to analyze your field"
    } else if s.farm.is_none() {
        "Select a field to continue"
    } else if s.soil_blocked() {
        "Review your soil choice"
    } else if s.adjustment_blocked() {
        "Review your climate scenario"
    } else {
        "Your field is ready to analyze"
    };
    let next_step = if s.loading {
        "Checking climate data and comparing crop sequences for your field.".to_owned()
    } else if !s.ready {
        "The analysis service is unavailable. Reconnect below; your saved draft is kept.".to_owned()
    } else if s.farm.is_none() {
        "Draw a boundary, import a GeoJSON file or use the sample field above.".to_owned()
    } else if s.soil_blocked() {
        "Open Soil texture and use the default reference to continue.".to_owned()
    } else if s.adjustment_blocked() {
        "Open the climate controls and reset the unsupported adjustment to continue.".to_owned()
    } else {
        format!(
            "{} · {} · {}",
            MONTHS
                .get(s.settings.mes_plantio.saturating_sub(1) as usize)
                .copied()
                .unwrap_or("Selected month"),
            HORIZONS
                .get(s.settings.horizonte.saturating_sub(1) as usize)
                .copied()
                .unwrap_or("Selected horizon"),
            if s.history.is_empty() {
                "without crop history".to_owned()
            } else {
                format!(
                    "{} history {}",
                    s.history.len(),
                    if s.history.len() == 1 {
                        "entry"
                    } else {
                        "entries"
                    }
                )
            }
        )
    };
    view = view.child(
        panel()
            .key("analysis-action")
            .w_full()
            .gap(14.0)
            .fill(color("#edf2e5"))
            .child(
                col()
                    .gap(7.0)
                    .w_full()
                    .child(label(summary, 18.0, 600.0, INK).wrap().w_full())
                    .child(label(next_step, 13.0, 400.0, MUTED).wrap().w_full())
                    .child(
                        label(
                            "Your location, crop order and planning options will be sent for analysis.",
                            11.0,
                            400.0,
                            MUTED,
                        )
                        .wrap(),
                    ),
            )
            .child(action),
    );
    if s.loading {
        view = view.child(paragraph("Looking up climate data and calculating your options. The first POWER request may take a few minutes; the timeout is 6 minutes. You can cancel and continue editing."));
        view = view.child(button(k, "cancel", "Cancel analysis", false, |_| {
            host(json!({"type":"cancel"}))
        }));
    }
    if !s.ready {
        view = view.child(button(k, "reconnect", "Reconnect to engine", false, |_| {
            host(json!({"type":"connect"}))
        }));
    }
    view
}
fn field_panel(s: &State, k: &Kit, narrow: bool) -> El {
    let mut view = panel()
        .w_full()
        .child(label("Your field", 23.0, 600.0, INK));
    let Some(field) = &s.field_context else {
        return view.child(paragraph("Vegetation and terrain observations are available only for the demonstration field boundary. These data are not yet available for this field."));
    };
    view = view
        .child(pill("DEMONSTRATION FIELD", "#e9efd9", INK))
        .child(paragraph(&field.summary))
        .child(button(
            k,
            "field-toggle",
            if s.field_open {
                "Hide field observations"
            } else {
                "Show field observations"
            },
            false,
            |s| s.field_open = !s.field_open,
        ));
    if !s.field_open {
        return view;
    }
    let mut chart = row().gap(8.0).w_full().min_w(660.0);
    for month in &field.months {
        chart = chart.child(
            col()
                .w(0.0)
                .grow(1.0)
                .min_w(0.0)
                .gap(8.0)
                .center()
                .child(label(&month.value, 11.0, 500.0, INK))
                .child(
                    col().h(100.0).w_full().justify_end().child(
                        el().w_full()
                            .h(month.height * 100.0)
                            .radius(4.0)
                            .fill(color(if month.height < 0.4 {
                                "#ac873e"
                            } else {
                                "#709454"
                            })),
                    ),
                )
                .child(label(&month.label, 11.0, 600.0, INK))
                .child(label(&month.frequency, 10.0, 400.0, MUTED)),
        );
    }
    view.child(label("Vegetation through the year", 18.0, 600.0, INK))
        .child(paragraph("Bars: mean monthly NDVI, on a 0–1 scale for this field. Percentages below the months: frequency of bare-soil or crop-residue indicators. Swipe to see all 12 months."))
        .child(el().w_full().scroll_x().child(chart))
        .child(paragraph(&field.coverage))
        .child(rule())
        .child(responsive_row(narrow)
            .child(column_width(col().gap(8.0).child(eyebrow("TERRAIN")).child(paragraph(&field.terrain)), narrow, 1.0))
            .child(column_width(col().gap(8.0).child(eyebrow("SATELLITE + GROUND STATION")).child(paragraph(&field.station)), narrow, 1.0)))
        .child(col().gap(8.0).padding(14.0).radius(9.0).fill(color("#eaf1ef"))
            .child(eyebrow("HOW THE CLIMATE MODELS DIFFER"))
            .child(paragraph(&field.model_spread)))
        .child(label(&field.source, 11.0, 400.0, MUTED).wrap().w_full())
}
fn glossary(s: &State, k: &Kit) -> El {
    let mut view = col().w_full().gap(14.0).child(
        button(
            k,
            "glossary-toggle",
            if s.glossary_open {
                "Understand the terms · collapse"
            } else {
                "Understand the terms · expand"
            },
            false,
            |s| s.glossary_open = !s.glossary_open,
        )
        .expanded(s.glossary_open),
    );
    if s.glossary_open {
        view = view.child(label("Scope: one field. Sources have different resolutions: climate at a point, NDVI at 250 m and elevation at 30 m. Vegetation and terrain data are available for the demonstration field.", 11.0, 400.0, MUTED).wrap().w_full());
        for (term, definition) in [
            (
                "Evapotranspiration",
                "Water that moves from the soil and plants into the atmosphere. ET0 is reference demand; ETc is estimated crop demand, calculated using its Kc. Values are in millimeters.",
            ),
            (
                "Kc",
                "Crop coefficient: multiplies ET0 to estimate ETc. It changes through the crop cycle; it is not an amount of water.",
            ),
            (
                "Deficit",
                "The part of water demand that rainfall and stored soil water cannot meet in the engine's water balance. It is an estimate in millimeters, not an irrigation prescription.",
            ),
            (
                "Water demand met",
                "How much demand was met in the estimated water balance. The screen shows a 0–100 index; higher means less unmet demand, not a probability of success.",
            ),
            (
                "Available soil water",
                "Water the soil stores for plants between rain events. The calculation uses 30 mm for sandy soil, 45 mm for medium texture and 60 mm for clay soil; these are texture references, not field measurements.",
            ),
            (
                "Ky · response to water shortage",
                "Describes how much yield falls when water is scarce in the engine's daily mode. Above 1, the proportional yield loss exceeds the water shortage: corn has a Ky of 1.25, so 10% unmet demand reduces estimated yield by 12.5% through this factor.",
            ),
            (
                "Frost risk",
                "The daily engine counts days with a minimum air temperature of 3 °C or below in a weather shelter. Leaves can be colder and freeze even when the air is above 0 °C; the count indicates risk, not confirmed crop damage.",
            ),
            (
                "Bad year",
                "An actual year among those with the lowest scores in daily mode: with 19 years assessed, the engine selects the 4th worst by score, roughly 1 in 5. This position summarizes the historical series; it does not predict the frequency of future losses.",
            ),
            (
                "Technical tie",
                "On this screen, options less than 2 points behind the leader in today's score; the third option when the next sequence (#4), not shown in the cards, is less than 2 points below it; and, in the future ranking, options less than 2 points from the sequence just above or below. This margin accounts for natural year-to-year variation: it flags close results while preserving the engine's scores and order.",
            ),
            (
                "NDVI",
                "A vegetation index calculated from light reflected by the surface, ranging from −1 to 1. Higher values often indicate greener vegetation; low values may also indicate crop residue or bare soil. It does not directly measure soil health.",
            ),
            (
                "Climate suitability",
                "How well the sequence fits the temperature, rainfall and heat conditions used by the engine. The sequence is limited by its least suitable crop. A 0–100 index, not the probability of withstanding extreme events.",
            ),
            (
                "Nitrogen-fixing crop",
                "Soybean, common bean and sunn hemp capture nitrogen from the air with help from root bacteria; much of it leaves with the grain in soybean and common bean, so the engine only gives the next crop a nitrogen credit after green manure such as sunn hemp.",
            ),
            (
                "Cover crops / crop residue",
                "Corn, sorghum, pearl millet, brachiaria and sunn hemp help cover the soil or leave crop residue, shielding it from rain and sun and reducing erosion.",
            ),
            (
                "Deep roots",
                "Corn, sorghum and brachiaria can reach water in deeper layers and improve soil structure; rooting depth depends on field conditions.",
            ),
            (
                "Drought tolerance",
                "Sorghum and pearl millet can better maintain yield in a second season with limited rainfall; tolerance does not mean there are no losses from water shortage.",
            ),
        ] {
            view = view.child(
                col()
                    .gap(5.0)
                    .w_full()
                    .child(label(term, 15.0, 600.0, INK).wrap().w_full())
                    .child(paragraph(definition)),
            );
        }
        view = view.child(rule())
            .child(label("Check with your agronomist", 17.0, 600.0, INK))
            .child(paragraph("Revenue is gross, before costs; historical prices and values flagged for review need local validation. Heat thresholds vary by cultivar and growth stage. When no threshold is recorded, the engine does not apply a heat penalty; this does not establish heat tolerance."))
            .child(paragraph("The calculation uses a water reserve of 30 mm for sandy soil, 45 mm for medium texture and 60 mm for clay soil. With no texture specified, the reference is 60 mm. These are class references, not measurements of this field."))
            .child(paragraph("Sequence rules use a 0.85 factor for repeated crops and a 1.10 bonus for a non-fixing crop planted within 60 days after green manure. This window is provisional. Pairs that share a pest or disease may receive another penalty; details show the applied factor. Soil index weights are 0.4/0.4/0.2 (nitrogen fixation, soil cover, diversity); grain legumes such as soybean and bean get half of the nitrogen weight because the harvest exports the fixed nitrogen. The index does not measure actual soil quality. These rules do not replace an agronomic assessment."));
    }
    view
}
fn soil_panel(s: &State, k: &Kit, narrow: bool) -> El {
    if !s.soil_available && !s.soil_blocked() {
        return el();
    }
    let mut view = panel()
        .key("soil-panel")
        .gap(14.0)
        .w_full()
        .child(if s.page == Page::Setup {
            disclosure("soil-toggle", "Soil texture", s.soil_open, |s| {
                s.soil_open = !s.soil_open
            })
        } else {
            label("Soil texture", 19.0, 600.0, INK)
                .wrap()
                .w_full()
                .role("heading")
                .level(2)
        });
    if s.page == Page::Setup && !s.soil_open {
        if s.soil_blocked() {
            view = view.child(paragraph("Your saved soil choice needs attention. Open Soil texture to use the default reference and continue."));
        }
        return view;
    }
    view = view.child(paragraph("Texture determines the water reserve used in the calculation. Check the regional suggestion or select the soil you know in your field."));
    if s.soil_available {
        let mut choices = responsive_row(narrow);
        for (texture, name) in [
            (SoilTexture::Arenoso, "Sandy · 30 mm"),
            (SoilTexture::Medio, "Medium · 45 mm"),
            (SoilTexture::Argiloso, "Clay · 60 mm"),
        ] {
            let chosen = s.settings.solo_textura == Some(texture);
            choices = choices.child(column_width(
                button(
                    k,
                    &format!("soil-{texture:?}"),
                    &format!("{name}{}", if chosen { " · selected" } else { "" }),
                    chosen,
                    move |s| s.set_soil(Some(texture)),
                ),
                narrow,
                1.0,
            ));
        }
        view = view.child(choices);
        if s.soil_context.loading {
            view = view.child(paragraph("Looking up the regional soil suggestion…"));
        } else if let Some(suggestion) = s.soil_context.suggestion {
            let name = match suggestion {
                SoilTexture::Arenoso => "sandy",
                SoilTexture::Medio => "medium",
                SoilTexture::Argiloso => "clay",
            };
            view = view.child(paragraph(format!("Regional suggestion: {name}. Check before analyzing; the regional grid is not a field measurement.")));
        }
        if !s.soil_context.source.is_empty() {
            view = view.child(
                label(&s.soil_context.source, 12.0, 400.0, MUTED)
                    .wrap()
                    .w_full(),
            );
        }
        if !s.soil_context.notice.is_empty() {
            view = view.child(paragraph(&s.soil_context.notice));
        }
        if s.settings.solo_textura.is_none() {
            view = view.child(paragraph(
                "No texture specified: the analysis will use the 60 mm reference.",
            ));
        }
    } else {
        view = view.child(paragraph("The saved soil texture is unavailable for this analysis. Use the default reference to continue."));
    }
    view = view
        .child(button(k, "soil-default", "Use default reference · 60 mm", false, |s| s.set_soil(None)))
        .child(label(if s.page == Page::Setup { "Your choice will be used in the analysis. Values are millimeters of stored water, not irrigation." } else { "Changing texture reruns the analysis and resets the chat. Values represent the water reserve used in the calculation, not a measurement." }, 12.0, 400.0, MUTED).wrap().w_full());
    view
}
fn priorities_panel(s: &State, _: &Kit, narrow: bool) -> El {
    let weights = s.settings.prioridades;
    let total = weights.agua as f64 + weights.solo as f64 + weights.renda as f64;
    let mut view =
        panel()
            .key("priorities-panel")
            .gap(16.0)
            .w_full()
            .child(if s.page == Page::Setup {
                disclosure(
                    "priorities-toggle",
                    "Your priorities",
                    s.priorities_open,
                    |s| s.priorities_open = !s.priorities_open,
                )
            } else {
                label("Your priorities", 19.0, 600.0, INK)
                    .wrap()
                    .w_full()
                    .role("heading")
                    .level(2)
            });
    if s.page == Page::Setup && !s.priorities_open {
        return view;
    }
    view = view.child(paragraph("Choose what matters most in the comparison. Each criterion has a weight in the score that ranks rotations; up to three options with the highest scores are suggested."));
    for (index, name, description, selected) in [
        (
            0,
            "Water",
            "Favors rotations whose water needs are better met by rainfall and stored soil water.",
            weights.agua,
        ),
        (
            1,
            "Soil",
            "Favors soil cover, nitrogen fixation and crop diversity.",
            weights.solo,
        ),
        (
            2,
            "Income",
            "Favors higher gross revenue per hectare and per year of field occupancy. Costs are not deducted.",
            weights.renda,
        ),
    ] {
        let mut choices = row().gap(6.0).w_full();
        for (value, title, visible_title) in [
            (0, "no weight", "No weight"),
            (1, "low", "Low"),
            (2, "medium", "Medium"),
            (3, "high", "High"),
        ] {
            let chosen = selected == value;
            choices = choices.child(
                row()
                    .key(format!("priority-{index}-{value}"))
                    .w(0.0)
                    .min_w(0.0)
                    .grow(1.0)
                    .h(44.0)
                    .center()
                    .radius(8.0)
                    .fill(color(if chosen { "#355e3e" } else { "#f4f6ee" }))
                    .border(1.0, color(if chosen { "#355e3e" } else { LINE }))
                    .hover(color(INK).alpha(0.06))
                    .press(color(INK).alpha(0.10))
                    .child(label(
                        format!("{value} {visible_title}"),
                        11.0,
                        600.0,
                        if chosen { "#ffffff" } else { INK },
                    ))
                    .role("button")
                    .label(format!(
                        "{name}: priority {value} ({title}){}",
                        if chosen { ", selected" } else { "" }
                    ))
                    .checked(chosen)
                    .focusable(true)
                    .on_press(move |s: &mut State| s.set_priority(index, value)),
            );
        }
        view = view.child(
            responsive_row(narrow)
                .child(column_width(
                    col()
                        .gap(5.0)
                        .child(label(name, 15.0, 600.0, INK))
                        .child(label(description, 12.0, 400.0, MUTED).wrap().w_full()),
                    narrow,
                    1.0,
                ))
                .child(column_width(choices, narrow, 1.4)),
        );
    }
    // Preview only the relative weights; scores and rankings still come from the API.
    let mut shares = row().gap(8.0).w_full();
    for (name, weight) in [
        ("Water", weights.agua),
        ("Soil", weights.solo),
        ("Income", weights.renda),
    ] {
        let percent = if total == 0.0 {
            100.0 / 3.0
        } else {
            100.0 * weight as f64 / total
        };
        let value = format!("{percent:.1}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned();
        shares = shares.child(
            col()
                .w(0.0)
                .min_w(0.0)
                .grow(1.0)
                .gap(4.0)
                .role("group")
                .label(format!("{name} · {value}%"))
                .child(label(name, 12.0, 400.0, MUTED).wrap().w_full())
                .child(label(format!("{value}%"), 18.0, 600.0, INK).wrap().w_full()),
        );
    }
    view = view
        .child(col().gap(10.0).padding(14.0).radius(9.0).fill(color("#eaf1ef"))
            .child(label("Calculation weights", 14.0, 600.0, INK).wrap().w_full())
            .child(shares)
            .child(label(if total == 0.0 {
                "All set to zero: we use equal weights for the three criteria, just like 1/1/1."
            } else {
                "Weights are relative: 3 has three times the weight of 1. The order of suggestions may change, depending on the available options."
            }, 12.0, 400.0, MUTED).wrap().w_full()))
        .child(label("No weight removes a criterion from the main score without excluding crops or hiding risks. All three criteria are considered when breaking an exact tie.", 12.0, 400.0, MUTED).wrap().w_full());
    if s.page != Page::Setup {
        view = view.child(
            label(
                "Changing a priority reruns the analysis and resets the chat.",
                12.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    } else {
        view = view.child(
            label(
                "Your choices will be used when you click Analyze farm.",
                12.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    }
    view
}
fn scenario_value(value: f64, unit: &str) -> String {
    let number = if value == 0.0 {
        "0".to_owned()
    } else {
        format!("{value:+.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    };
    format!("{number}{unit}")
}
fn scenario_control(s: &State, k: &Kit, field: usize) -> El {
    let adjustment = s.adjustment_preview.unwrap_or(s.settings.ajuste);
    let (name, value, min, max, step, unit, down, up) = if field == 0 {
        (
            "Rainfall",
            adjustment.chuva_pct,
            -50.0,
            30.0,
            5.0,
            "%",
            "Decrease rainfall by 5%",
            "Increase rainfall by 5%",
        )
    } else {
        (
            "Temperature",
            adjustment.temp_c,
            0.0,
            4.0,
            0.5,
            " °C",
            "Decrease temperature by 0.5 °C",
            "Increase temperature by 0.5 °C",
        )
    };
    let fraction = ((value - min) / (max - min)) as f32;
    let accent = if s.scenario_available {
        "#355e3e"
    } else {
        "#aab6a4"
    };
    let mut track = el()
        .key(format!("scenario-track-{field}"))
        .w(0.0)
        .min_w(0.0)
        .grow(1.0)
        .h(44.0)
        .center_y()
        .role("group")
        .label(format!("Scenario {name}: {}", scenario_value(value, unit)))
        .child(
            row()
                .w_full()
                .h(22.0)
                .center_y()
                .child(
                    el().w(0.0)
                        .grow(fraction)
                        .h(6.0)
                        .radius(3.0)
                        .fill(color(accent)),
                )
                .child(
                    el().w(22.0)
                        .h(22.0)
                        .radius(11.0)
                        .fill(color(accent))
                        .border(3.0, Color::WHITE),
                )
                .child(
                    el().w(0.0)
                        .grow(1.0 - fraction)
                        .h(6.0)
                        .radius(3.0)
                        .fill(color(LINE)),
                ),
        );
    if s.scenario_available {
        track = track
            .focusable(true)
            .range_value(value, min, max)
            .range_step(step)
            .on_step(move |s: &mut State, delta, _| {
                s.step_adjustment(field, delta);
            })
            .on_step_limit(move |s: &mut State, end, _| {
                s.change_adjustment(field, if end { max } else { min })
            })
            .on_drag(move |s: &mut State, drag, _| {
                if drag.cancelled() {
                    s.adjustment_preview = None;
                    return;
                }
                let fraction = ((drag.x - 11.0) / (drag.w - 22.0).max(1.0)).clamp(0.0, 1.0) as f64;
                let value = ((min + fraction * (max - min)) / step).round() * step;
                let mut adjustment = s.settings.ajuste;
                if field == 0 {
                    adjustment.chuva_pct = value;
                } else {
                    adjustment.temp_c = value;
                }
                if drag.phase == rune::Phase::Up {
                    s.save_adjustment(adjustment);
                } else {
                    s.adjustment_preview = Some(adjustment);
                }
            })
            .role("group");
    }
    col()
        .gap(8.0)
        .w_full()
        .child(
            row()
                .justify_between()
                .center_y()
                .gap(8.0)
                .child(label(name, 15.0, 600.0, INK))
                .child(label(scenario_value(value, unit), 20.0, 600.0, accent)),
        )
        .child(
            row()
                .gap(10.0)
                .w_full()
                .center_y()
                .child(
                    Button::new("−")
                        .variant(ButtonVariant::Outline)
                        .disabled(!s.scenario_available || value <= min)
                        .on_press(move |s: &mut State| s.step_adjustment(field, -1))
                        .build(k)
                        .key(format!("scenario-minus-{field}"))
                        .label(down)
                        .w(44.0)
                        .h(44.0),
                )
                .child(track)
                .child(
                    Button::new("+")
                        .variant(ButtonVariant::Outline)
                        .disabled(!s.scenario_available || value >= max)
                        .on_press(move |s: &mut State| s.step_adjustment(field, 1))
                        .build(k)
                        .key(format!("scenario-plus-{field}"))
                        .label(up)
                        .w(44.0)
                        .h(44.0),
                ),
        )
        .child(
            row()
                .justify_between()
                .w_full()
                .child(label(scenario_value(min, unit), 11.0, 400.0, MUTED))
                .child(label(scenario_value(max, unit), 11.0, 400.0, MUTED)),
        )
}
fn scenario_panel(s: &State, k: &Kit, narrow: bool) -> El {
    let mut view =
        panel()
            .key("scenario-panel")
            .w_full()
            .gap(16.0)
            .child(if s.page == Page::Setup {
                disclosure(
                    "scenario-toggle",
                    "What if the climate changes in your region?",
                    s.scenario_open,
                    |s| s.scenario_open = !s.scenario_open,
                )
            } else {
                label(
                    "What if the climate changes in your region?",
                    19.0,
                    600.0,
                    INK,
                )
                .wrap()
                .w_full()
                .role("heading")
                .level(2)
            });
    if s.page == Page::Setup && !s.scenario_open {
        if s.adjustment_blocked() {
            view = view.child(paragraph("Your saved climate scenario needs attention. Open this section to reset the climate and continue."));
        }
        return view;
    }
    view = view.child(paragraph("What if it rains less or gets hotter? This is a simulation, not a forecast. The same adjustment applies to every month of today's, future and dry-year scenarios, when available."))
        .child(responsive_row(narrow)
            .child(column_width(scenario_control(s, k, 0), narrow, 1.0))
            .child(column_width(scenario_control(s, k, 1), narrow, 1.0)));
    if !s.scenario_available {
        view = view.child(paragraph(
            "Scenario adjustments are not yet available on this server.",
        ));
    } else {
        view = view.child(label("Drag the controls or use − and +. On a keyboard, use the arrow keys, Home and End. Change rainfall in 5% steps and temperature in 0.5 °C steps, then apply to recalculate.", 12.0, 400.0, MUTED).wrap().w_full());
    }
    if s.adjustment_blocked() {
        let message = "Your draft has an adjusted scenario. Reset the climate to analyze on this server; the saved values will not be ignored.";
        view = view.child(col().role("alert").label(message).child(paragraph(message)));
    }
    view = view.child(
        Button::new("Reset climate adjustments")
            .variant(ButtonVariant::Outline)
            .disabled(!s.settings.ajuste.active())
            .on_press(|s: &mut State| s.save_adjustment(Adjustment::default()))
            .build(k)
            .key("scenario-reset")
            .h(44.0)
            .w_full(),
    );
    if s.page != Page::Setup {
        view = view.child(label("Changing the scenario resets the previous analysis and chat. Use Apply scenario to request the new results.", 12.0, 400.0, MUTED).wrap().w_full());
    }
    view
}
fn adjustment_banner(analysis: &Analysis) -> El {
    if analysis.adjustment_note.is_empty() {
        return el();
    }
    panel()
        .fill(color("#fff4df"))
        .gap(8.0)
        .w_full()
        .child(eyebrow("WHAT-IF SCENARIO"))
        .child(paragraph(&analysis.adjustment_note))
}
fn planning_panel(s: &State, k: &Kit, overlays: &mut Vec<El>, narrow: bool) -> El {
    let month = Select::new("month-select", MONTHS)
        .appearance(SelectAppearance::Field)
        .label("Month when the field becomes available")
        .current(Some(MONTHS[(s.settings.mes_plantio - 1) as usize]))
        .open(s.month_open)
        .on_toggle(|s: &mut State| {
            s.month_open = !s.month_open;
            s.crop_open = false;
            s.horizon_open = false;
        })
        .on_close(|s: &mut State| s.month_open = false)
        .on_choose(|s: &mut State, value, _| {
            if let Some(i) = MONTHS.iter().position(|m| *m == value) {
                s.settings.mes_plantio = (i + 1) as u8;
                s.save_settings();
            }
        })
        .build(k, overlays)
        .w_full()
        .h(44.0);
    let horizon = Select::new("horizon-select", HORIZONS)
        .appearance(SelectAppearance::Field)
        .label("Number of crops to plan")
        .current(Some(HORIZONS[(s.settings.horizonte - 1) as usize]))
        .open(s.horizon_open)
        .on_toggle(|s: &mut State| {
            s.horizon_open = !s.horizon_open;
            s.crop_open = false;
            s.month_open = false;
        })
        .on_close(|s: &mut State| s.horizon_open = false)
        .on_choose(|s: &mut State, value, _| {
            if let Some(i) = HORIZONS.iter().position(|h| *h == value) {
                s.settings.horizonte = (i + 1) as u8;
                s.save_settings();
            }
        })
        .build(k, overlays)
        .w_full()
        .h(44.0);
    panel().child(label("03  Plan your next planting", 19.0, 600.0, INK).wrap().w_full())
        .child(paragraph("Choose when the field becomes available and how many crops you want to plan."))
        .child(responsive_row(narrow)
            .child(column_width(col().gap(8.0).child(eyebrow("FIELD AVAILABLE FROM")).child(month), narrow, 1.0))
            .child(column_width(col().gap(8.0).child(eyebrow("PLANNING HORIZON")).child(horizon), narrow, 1.0)))
        .child(paragraph("The calendar assumes the field is available on the first day of this month. The analysis checks each crop's planting windows."))
}
fn category(category: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match category {
        "current" => (
            "CURRENT ROTATION",
            "Your comparison reference",
            "#71624a",
            "#f0ebe2",
        ),
        "rank1" => (
            "1ST TODAY",
            "Highest score for your priorities",
            "#805817",
            "#f3ebd7",
        ),
        "rank2" => ("2ND TODAY", "Second-highest score", "#4c682c", "#e9efd9"),
        _ => ("3RD TODAY", "Third-highest score", "#356571", "#e4eff0"),
    }
}
fn revenue_context(title: &str, note: &str, compact: bool) -> El {
    if note.is_empty() {
        return el();
    }
    col()
        .w_full()
        .gap(7.0)
        .padding(if compact { 12.0 } else { 14.0 })
        .radius(9.0)
        .fill(color("#edf2e6"))
        .child(eyebrow(title.to_uppercase()).wrap().w_full())
        .child(
            label(note, if compact { 12.0 } else { 14.0 }, 400.0, INK)
                .wrap()
                .w_full(),
        )
}

fn recommendation_card(
    rec: &Recommendation,
    selection: SelectedStrategy,
    k: &Kit,
    narrow: bool,
    demo: bool,
) -> El {
    let (name, tagline, accent, tint) = category(&rec.category);
    let comparison_label = rec
        .rank_facts
        .iter()
        .chain(rec.comparison_facts.iter())
        .chain(
            rec.exposure
                .iter()
                .flat_map(|exposure| exposure.card_facts.iter()),
        )
        .map(|fact| format!("{}: {}", fact.label, fact.value))
        .collect::<Vec<_>>()
        .join("; ");
    let warnings_label = rec.warnings.as_ref().map_or_else(
        || "Warnings are unavailable in this engine response.".to_owned(),
        |warnings| {
            let first = warnings
                .risks
                .first()
                .into_iter()
                .chain(warnings.gaps.first())
                .map(|warning| warning.card_summary.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            format!("{} {}", warnings.summary, first)
        },
    );
    let benefits_label = rec.benefits.as_ref().map_or_else(
        || "Benefits are unavailable in this engine response.".to_owned(),
        |benefits| {
            format!(
                "{} {}",
                benefits.summary,
                benefits.items.first().map_or("", |item| &item.card_summary)
            )
        },
    );
    let marker = match selection {
        SelectedStrategy::Current => "REF.".to_owned(),
        SelectedStrategy::Ranked(i) => format!("0{}", i + 1),
    };
    let mut metrics = col().gap(14.0).w_full();
    if let Some(fact) = rec.comparison_facts.first() {
        metrics = metrics.child(
            col()
                .gap(4.0)
                .w_full()
                .child(label(&fact.label, 11.0, 400.0, MUTED).wrap().w_full())
                .child(label(&fact.value, 24.0, 600.0, INK).wrap().w_full()),
        );
    }
    let mut secondary = row().gap(12.0).w_full();
    for fact in rec.comparison_facts.iter().skip(1) {
        secondary = secondary.child(column_width(
            col()
                .gap(5.0)
                .child(label(&fact.label, 11.0, 400.0, MUTED).wrap().w_full())
                .child(label(&fact.value, 18.0, 600.0, INK).wrap().w_full()),
            false,
            1.0,
        ));
    }
    metrics = metrics.child(secondary);
    let mut rankings = col()
        .gap(12.0)
        .w_full()
        .padding(14.0)
        .radius(9.0)
        .fill(color(tint));
    for pair in rec.rank_facts.chunks(2) {
        let mut line = row().gap(8.0).w_full();
        for fact in pair {
            line = line.child(column_width(
                col()
                    .gap(5.0)
                    .child(label(&fact.label, 11.0, 400.0, MUTED).wrap().w_full())
                    .child(label(&fact.value, 18.0, 600.0, accent).wrap().w_full()),
                false,
                1.0,
            ));
        }
        rankings = rankings.child(line);
    }
    let mut exposure_summary = col()
        .gap(9.0)
        .padding(12.0)
        .radius(9.0)
        .fill(color("#f6f0e6"));
    if let Some(exposure) = &rec.exposure {
        for fact in &exposure.card_facts {
            exposure_summary = exposure_summary.child(
                col()
                    .gap(3.0)
                    .w_full()
                    .child(label(&fact.label, 10.0, 400.0, MUTED).wrap().w_full())
                    .child(label(&fact.value, 17.0, 600.0, "#855535").wrap().w_full()),
            );
        }
    } else {
        exposure_summary = exposure_summary.child(
            label(
                "Soil between crops: data are unavailable in this analysis.",
                11.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    }
    let header = col()
        .gap(12.0)
        .child(
            row()
                .center_y()
                .justify_between()
                .child(pill(
                    if rec.tie_note.is_empty() || matches!(selection, SelectedStrategy::Current) {
                        name
                    } else {
                        "TECHNICAL TIE"
                    },
                    tint,
                    accent,
                ))
                .child(label(marker, 12.0, 400.0, accent)),
        )
        .child(
            label(
                if rec.tie_note.is_empty() {
                    tagline
                } else if !rec.tie_note.contains("· today") {
                    "Close scores in the future climate"
                } else if rec.tie_note.contains("· future") {
                    "Close scores today and in the future"
                } else {
                    "Close scores in today's climate"
                },
                12.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        )
        .child(label(&rec.crop, 25.0, 600.0, INK).wrap().w_full().min_h(
            if !narrow && matches!(selection, SelectedStrategy::Ranked(_)) {
                60.0
            } else {
                0.0
            },
        ))
        .child(
            row()
                .w_full()
                .center_y()
                .justify_between()
                .px(12.0)
                .min_h(44.0)
                .radius(8.0)
                .fill(color(tint))
                .child(label("Explore timeline", 13.0, 600.0, accent))
                .child(label("→", 22.0, 400.0, accent)),
        );
    let overview = col()
        .w_full()
        .gap(16.0)
        .child(header)
        .child(rankings)
        .child(if rec.tie_note.is_empty() {
            el()
        } else {
            label(&rec.tie_note, 12.0, 600.0, INK).wrap().w_full()
        })
        .child(if rec.model_note.is_empty() {
            el()
        } else {
            label(&rec.model_note, 12.0, 400.0, MUTED).wrap().w_full()
        })
        .child(metrics);
    let supporting = col()
        .w_full()
        .gap(12.0)
        .child(revenue_context("REVENUE CONTEXT", &rec.revenue_note, true))
        .child(exposure_summary)
        .child(benefits_card(rec))
        .child(warnings_card(rec))
        .child(label(
            if demo {
                "ILLUSTRATIVE EXAMPLE"
            } else {
                "ANALYSIS RESULT"
            },
            9.0,
            600.0,
            MUTED,
        ));
    // The reference uses the same evidence as a ranked card, with room for a
    // horizontal comparison. It must never look like an extra recommendation.
    let body = if matches!(selection, SelectedStrategy::Current) && !narrow {
        responsive_row(false)
            .child(column_width(overview, false, 1.0))
            .child(column_width(supporting, false, 1.0))
    } else {
        col().w_full().gap(16.0).child(overview).child(supporting)
    };
    column_width(
        Card::new()
            .accent(color(accent))
            .child(body)
            .build(k)
            .key(format!("card-{}", rec.category))
            .fill(Color::WHITE)
            .hover(color(INK).alpha(0.045))
            .press(color(INK).alpha(0.08))
            .padding(20.0)
            .radius(14.0)
            .border(1.0, color(LINE))
            .role("button")
            .label(format!(
                "{}: {}. {}. {} {} {} {} {} Open timeline",
                name,
                rec.crop,
                comparison_label,
                rec.tie_note,
                rec.model_note,
                rec.revenue_note,
                benefits_label,
                warnings_label
            ))
            .focusable(true)
            .on_press(move |s: &mut State| s.select(selection)),
        narrow,
        1.0,
    )
}
fn warnings_card(rec: &Recommendation) -> El {
    let mut view = col().gap(12.0).w_full();
    let Some(warnings) = &rec.warnings else {
        return view.child(
            label(
                "Warnings are unavailable in this engine response.",
                12.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    };
    if warnings.risks.is_empty() && warnings.gaps.is_empty() {
        return view
            .child(label(&warnings.summary, 12.0, 500.0, MUTED).wrap().w_full())
            .child(
                label(
                    "This does not guarantee an absence of risk.",
                    11.0,
                    400.0,
                    MUTED,
                )
                .wrap()
                .w_full(),
            );
    }
    for (title, items, ink, bg) in [
        ("Risks", &warnings.risks, "#855535", "#f6f0e6"),
        ("Data gaps", &warnings.gaps, "#416773", "#edf3f4"),
    ] {
        let mut group = col()
            .gap(6.0)
            .padding(12.0)
            .radius(9.0)
            .w_full()
            .fill(color(bg))
            .child(
                label(format!("{title} · {}", items.len()), 12.0, 600.0, ink)
                    .wrap()
                    .w_full(),
            );
        group = group.child(
            label(
                items
                    .first()
                    .map_or("No warnings flagged.", |warning| &warning.card_summary),
                12.0,
                400.0,
                INK,
            )
            .wrap()
            .w_full(),
        );
        if items.len() > 1 {
            group = group.child(
                label(format!("+{} in details", items.len() - 1), 11.0, 500.0, ink)
                    .wrap()
                    .w_full(),
            );
        }
        view = view.child(group);
    }
    view
}
fn benefits_card(rec: &Recommendation) -> El {
    let mut view = col()
        .gap(6.0)
        .w_full()
        .padding(12.0)
        .radius(9.0)
        .fill(color("#eef3e7"));
    let Some(benefits) = &rec.benefits else {
        return view.child(
            label(
                "Benefits are unavailable in this engine response.",
                12.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    };
    view = view
        .child(
            label(
                format!("Benefits · {}", benefits.items.len()),
                12.0,
                600.0,
                "#496b35",
            )
            .wrap()
            .w_full(),
        )
        .child(
            label(
                benefits
                    .items
                    .first()
                    .map_or(benefits.summary.as_str(), |item| &item.card_summary),
                12.0,
                400.0,
                INK,
            )
            .wrap()
            .w_full(),
        );
    if benefits.items.len() > 1 {
        view = view.child(
            label(
                format!("+{} in details", benefits.items.len() - 1),
                11.0,
                500.0,
                "#496b35",
            )
            .wrap()
            .w_full(),
        );
    }
    view
}
fn benefits_panel(rec: &Recommendation) -> El {
    let mut view = panel().gap(16.0).w_full().child(
        label("Benefits considered by the engine", 22.0, 600.0, INK)
            .wrap()
            .w_full()
            .role("heading")
            .level(2),
    );
    let Some(benefits) = &rec.benefits else {
        return view.child(paragraph(
            "Benefits are unavailable in this engine response.",
        ));
    };
    view = view.child(paragraph(&benefits.summary));
    for item in &benefits.items {
        view = view.child(
            col()
                .gap(6.0)
                .padding(14.0)
                .radius(10.0)
                .w_full()
                .fill(color("#eef3e7"))
                .child(
                    label(&item.title, 16.0, 600.0, INK)
                        .wrap()
                        .w_full()
                        .role("heading")
                        .level(3),
                )
                .child(label(&item.context, 12.0, 600.0, "#496b35").wrap().w_full())
                .child(paragraph(&item.description))
                .child(
                    label(format!("Engine data: {}", item.evidence), 12.0, 500.0, INK)
                        .wrap()
                        .w_full(),
                ),
        );
    }
    view.child(label(&benefits.note, 12.0, 400.0, MUTED).wrap().w_full())
}
fn warning_group(title: &str, items: &[StrategyWarning], ink: &str, bg: &str) -> El {
    let mut group = col().gap(14.0).w_full().child(
        label(format!("{title} · {}", items.len()), 18.0, 600.0, ink)
            .wrap()
            .w_full()
            .role("heading")
            .level(3),
    );
    if items.is_empty() {
        return group.child(paragraph(
            "The engine did not flag any warnings of this type.",
        ));
    }
    for warning in items {
        group = group.child(
            col()
                .gap(8.0)
                .padding(16.0)
                .radius(10.0)
                .fill(color(bg))
                .w_full()
                .child(
                    label(&warning.title, 16.0, 600.0, INK)
                        .wrap()
                        .w_full()
                        .role("heading")
                        .level(4),
                )
                .child(label(&warning.context, 12.0, 600.0, ink).wrap().w_full())
                .child(paragraph(&warning.description))
                .child(
                    label(
                        format!("Engine data: {}", warning.evidence),
                        12.0,
                        500.0,
                        INK,
                    )
                    .wrap()
                    .w_full(),
                ),
        );
    }
    group
}
fn warnings_panel(rec: &Recommendation, narrow: bool) -> El {
    let mut view = panel().gap(18.0).w_full().child(
        label("Risks and data gaps for this strategy", 22.0, 600.0, INK)
            .wrap()
            .w_full()
            .role("heading")
            .level(2),
    );
    let Some(warnings) = &rec.warnings else {
        return view.child(paragraph("Warnings are unavailable in this engine response."))
            .child(paragraph("The response did not include this sequence's warning list. That does not mean there are no risks or information to check."));
    };
    view = view.child(paragraph(&warnings.summary));
    if !warnings.risks.is_empty() || !warnings.gaps.is_empty() {
        view = view.child(
            responsive_row(narrow)
                .child(column_width(
                    warning_group("Risks to review", &warnings.risks, "#855535", "#f6f0e6"),
                    narrow,
                    1.0,
                ))
                .child(column_width(
                    warning_group("Information gaps", &warnings.gaps, "#416773", "#edf3f4"),
                    narrow,
                    1.0,
                )),
        );
    }
    view.child(label(&warnings.note, 12.0, 400.0, MUTED).wrap().w_full())
}
fn exposure_panel(s: &State, rec: &Recommendation, narrow: bool) -> El {
    let mut view = panel().gap(16.0).w_full().child(
        label("Soil between crops", 22.0, 600.0, INK)
            .role("heading")
            .level(2)
            .wrap()
            .w_full(),
    );
    let Some(exposure) = &rec.exposure else {
        return view.child(paragraph("Days without a standing crop and rainfall on exposed soil are unavailable in this analysis."));
    };
    view = view.child(paragraph(&exposure.period));
    for chunk in exposure.facts.chunks(2) {
        let mut line = responsive_row(narrow);
        for fact in chunk {
            line = line.child(column_width(
                col()
                    .gap(5.0)
                    .padding(14.0)
                    .radius(10.0)
                    .fill(color("#f6f7f0"))
                    .child(label(&fact.label, 11.0, 500.0, MUTED).wrap().w_full())
                    .child(label(&fact.value, 19.0, 600.0, INK).wrap().w_full()),
                narrow,
                1.0,
            ));
        }
        view = view.child(line);
    }
    let mut legend = responsive_row(narrow);
    for (title, fill) in [
        ("Standing crop", "#6f8e50"),
        ("No crop · with residue", "#c8a866"),
        ("Exposed · no residue", "#b26a43"),
    ] {
        legend = legend.child(
            row()
                .gap(7.0)
                .center_y()
                .child(el().size(12.0, 12.0).radius(3.0).fill(color(fill)))
                .child(label(title, 11.0, 500.0, MUTED).wrap()),
        );
    }
    let mut calendar = row().gap(6.0).w_full().min_w(1170.0);
    for (i, month) in exposure.months.iter().enumerate() {
        let mut bar = row().w_full().h(14.0).radius(3.0);
        for (days, fill) in [
            (month.month_days - month.days, "#6f8e50"),
            (month.days - month.exposed_days, "#c8a866"),
            (month.exposed_days, "#b26a43"),
        ] {
            if days > 0 {
                bar = bar.child(
                    el().w(0.0)
                        .min_w(0.0)
                        .grow(days as f32)
                        .h_full()
                        .fill(color(fill)),
                );
            }
        }
        calendar = calendar.child(
            col()
                .key(format!("exposure-month-{i}"))
                .w(0.0)
                .min_w(0.0)
                .grow(1.0)
                .padding(8.0)
                .gap(9.0)
                .radius(8.0)
                .fill(color(if i == s.exposure_month {
                    "#f4eadd"
                } else {
                    "#f8f9f5"
                }))
                .border(
                    1.0,
                    color(if i == s.exposure_month {
                        "#855535"
                    } else {
                        LINE
                    }),
                )
                .child(label(&month.label, 11.0, 600.0, INK).wrap().w_full())
                .child(bar)
                .child(
                    label(format!("{} d without crop", month.days), 10.0, 400.0, MUTED)
                        .wrap()
                        .w_full(),
                )
                .child(
                    label(
                        format!("{} d exposed", month.exposed_days),
                        10.0,
                        600.0,
                        "#855535",
                    )
                    .wrap()
                    .w_full(),
                )
                .role("button")
                .label(format!(
                    "Soil in {}: {} days without crop, {} exposed days",
                    month.label, month.days, month.exposed_days
                ))
                .hover(color(INK).alpha(0.06))
                .press(color(INK).alpha(0.10))
                .focusable(true)
                .on_press(move |s: &mut State| s.exposure_month = i),
        );
    }
    view = view.child(legend)
        .child(paragraph("Select a month to check rainfall. Swipe the calendar to see all 12 months; bars show proportions of days, not the exact dates of each interval."))
        .child(el().key("exposure-calendar").w_full().scroll_x().child(calendar));
    if let Some(month) = exposure.months.get(s.exposure_month) {
        view = view.child(col().key("exposure-month-detail").gap(10.0).padding(16.0)
            .radius(10.0).fill(color("#f6f0e6"))
            .child(label(format!("Soil in {}", month.label), 18.0, 600.0, INK).role("heading").level(3).wrap().w_full())
            .child(paragraph(format!("{} days without a standing crop; of these, {} days exposed without residue and {} days with estimated residue cover.", month.days, month.exposed_days, month.days - month.exposed_days)))
            .child(paragraph(format!("Rain on days without a crop: {}. Rain on exposed days: {}.", month.rain, month.exposed_rain)))
            .child(label(&exposure.caption, 11.0, 500.0, MUTED).wrap().w_full()));
    }
    view.child(paragraph(&exposure.erosion_note))
        .child(label(&exposure.note, 11.0, 400.0, MUTED).wrap().w_full())
}
fn current_rotation_card(current: &CurrentRotation, k: &Kit, narrow: bool, demo: bool) -> El {
    if let Some(rec) = &current.strategy {
        return recommendation_card(rec, SelectedStrategy::Current, k, narrow, demo);
    }
    let status = match current.status.as_str() {
        "no_history" => "NO HISTORY PROVIDED",
        "discarded" => "NOT FEASIBLE",
        _ => "COMPARISON UNAVAILABLE",
    };
    column_width(
        panel()
            .padding(18.0)
            .gap(18.0)
            .key("card-current")
            .child(pill("CURRENT ROTATION", "#f0ebe2", "#71624a"))
            .child(label("Your comparison reference", 12.0, 400.0, MUTED))
            .child(label(&current.title, 25.0, 600.0, INK).wrap().w_full())
            .child(label(status, 10.0, 600.0, "#71624a").wrap().w_full())
            .child(rule())
            .child(paragraph(&current.description))
            .child(button(
                k,
                "current-edit-history",
                "Review history and options",
                false,
                |s| s.page = Page::Setup,
            )),
        narrow,
        1.0,
    )
}
fn analysis_banner(analysis: &Analysis) -> El {
    let mut banner = col()
        .gap(9.0)
        .padding(16.0)
        .radius(10.0)
        .w_full()
        .fill(color(if analysis.demo { "#f1ecd9" } else { "#e8eedf" }))
        .child(
            label(
                if analysis.demo {
                    "FIXED ANALYSIS EXAMPLE"
                } else {
                    "HAPPY FARMERS ANALYSIS"
                },
                11.0,
                600.0,
                INK,
            )
            .wrap()
            .w_full(),
        )
        .child(label(&analysis.summary, 14.0, 600.0, INK).wrap().w_full());
    banner = banner.child(label(
        "We compare feasible crop sequences using planting windows, water, heat and crop history, then apply your priorities. Today's climate and the projection around 2060 use the same weights.",
        12.0, 400.0, MUTED,
    ).wrap().w_full());
    if !analysis.data_sources.is_empty() {
        banner = banner.child(rule()).child(eyebrow("DATA SOURCES")).child(
            label(&analysis.data_sources, 12.0, 400.0, MUTED)
                .wrap()
                .w_full(),
        );
    }
    if !analysis.source_warning.is_empty() {
        banner = banner.child(
            col()
                .gap(5.0)
                .padding(12.0)
                .radius(8.0)
                .fill(color("#fff3d7"))
                .child(
                    label("CLIMATE SOURCES AND LIMITS", 10.0, 600.0, "#72531c")
                        .wrap()
                        .w_full(),
                )
                .child(
                    label(&analysis.source_warning, 12.0, 500.0, "#72531c")
                        .wrap()
                        .w_full(),
                ),
        );
    }
    banner
}
fn farm_summary(s: &State) -> El {
    let Some(farm) = &s.farm else {
        return el();
    };
    label(
        format!(
            "{}  /  {} ha  /  {}",
            farm.name,
            format!("{:.2}", farm.area_ha).to_owned(),
            if s.history.is_empty() {
                "no history".into()
            } else {
                format!("{} season(s) provided", s.history.len())
            }
        ),
        12.0,
        500.0,
        MUTED,
    )
    .wrap()
    .w_full()
}
fn chat_panel(s: &State, k: &Kit, narrow: bool) -> El {
    if !s.chat.available || s.analysis.is_none() {
        return el();
    }
    let mut view = panel()
        .key("analysis-chat")
        .gap(14.0)
        .w_full()
        .child(
            label("Chat about this analysis", 22.0, 600.0, INK)
                .wrap()
                .w_full()
                .role("heading")
                .level(2),
        )
        .child(paragraph(
            "Ask about the cards, benefits, risks and calendar. AI explains the analysis results.",
        ))
        .child(button(
            k,
            "chat-toggle",
            if s.chat_open {
                "Close chat"
            } else {
                "Open AI chat"
            },
            false,
            |s| s.chat_open = !s.chat_open,
        ));
    if !s.chat_open {
        return view;
    }
    view = view.child(label("When you send a message, your question, conversation and analysis data — including coordinates and crop history — are sent to Anthropic. The conversation lasts only for this session and resets when you run a new analysis.", 12.0, 400.0, MUTED).wrap().w_full());
    let mut conversation = col().gap(12.0).w_full();
    if s.chat.messages.is_empty() && s.chat.pending.is_empty() {
        conversation = conversation.child(paragraph("You can ask: “Why were these strategies suggested?” or “Which data should I check before deciding?”"));
    }
    for (i, message) in s.chat.messages.iter().enumerate() {
        let producer = message.papel == "produtor";
        let mut bubble = col()
            .key(format!("chat-message-{i}"))
            .gap(7.0)
            .padding(14.0)
            .radius(10.0)
            .w_full()
            .fill(color(if producer { "#edf3e7" } else { "#f3f5ef" }))
            .child(label(
                if producer { "You" } else { "AI assistant" },
                12.0,
                600.0,
                INK,
            ))
            .child(
                label(&message.texto, 14.0, 400.0, INK)
                    .wrap()
                    .wrap_anywhere()
                    .w_full(),
            );
        if message.recusada {
            bubble = bubble.child(label("The AI did not answer this question. You can ask about another aspect of this analysis.", 12.0, 400.0, MUTED).wrap().w_full());
        }
        conversation = conversation.child(bubble);
    }
    if !s.chat.pending.is_empty() {
        conversation = conversation.child(
            col()
                .gap(7.0)
                .padding(14.0)
                .radius(10.0)
                .fill(color("#edf3e7"))
                .w_full()
                .child(label("You", 12.0, 600.0, INK))
                .child(
                    label(&s.chat.pending, 14.0, 400.0, INK)
                        .wrap()
                        .wrap_anywhere()
                        .w_full(),
                ),
        );
    }
    view = view.child(
        col()
            .key("chat-conversation")
            .w_full()
            .h(if s.chat.messages.is_empty() && s.chat.pending.is_empty() {
                if narrow { 100.0 } else { 56.0 }
            } else if narrow {
                280.0
            } else {
                320.0
            })
            .scroll(ScrollSpec { stick_bottom: true })
            .on_at_bottom(|s: &mut State, at_bottom| s.chat_at_bottom = at_bottom)
            .child(conversation),
    );
    if !s.chat_at_bottom {
        view = view.child(
            row()
                .key("chat-latest")
                .role("button")
                .label("View latest answer")
                .radius(8.0)
                .hover(color(INK).alpha(0.06))
                .press(color(INK).alpha(0.10))
                .focusable(true)
                .padding(10.0)
                .child(label("View latest answer ↓", 12.0, 600.0, INK))
                .on_press_tx(|_: &mut State, tx| tx.scroll_to_bottom("chat-conversation")),
        );
    }
    if s.chat.busy {
        view = view.child(
            col()
                .key("chat-busy")
                .w_full()
                .role("status")
                .label("The AI is preparing an answer…")
                .child(
                    label("The AI is preparing an answer…", 13.0, 500.0, INK)
                        .wrap()
                        .w_full(),
                ),
        );
    }
    if !s.chat.error.is_empty() {
        view = view.child(
            col()
                .key("chat-error")
                .w_full()
                .role("alert")
                .label(&s.chat.error)
                .child(label(&s.chat.error, 13.0, 500.0, "#963e2b").wrap().w_full()),
        );
    }
    if !s.chat.notice.is_empty() {
        view = view.child(
            col()
                .key("chat-notice")
                .w_full()
                .role("status")
                .label(&s.chat.notice)
                .child(label(&s.chat.notice, 12.0, 500.0, MUTED).wrap().w_full()),
        );
    }
    let count = s.chat_question.text.trim().chars().count();
    let disabled = s.chat.busy || s.chat.blocked;
    view = view
        .child(
            TextArea::new(&s.chat_question)
                .label("Your question about the analysis")
                .placeholder("Type your question…")
                .width(None)
                .auto_grow(2, 5)
                .wrap_anywhere()
                .disabled(disabled)
                .invalid(count > 1000)
                .on_edit(|s: &mut State| &mut s.chat_question)
                .on_submit(|s: &mut State, _| s.ask_chat())
                .build(k)
                .key("chat-question")
                .w_full(),
        )
        .child(
            label(
                format!("{count}/1,000 characters · Ctrl+Enter to send"),
                11.0,
                400.0,
                if count > 1000 { "#963e2b" } else { MUTED },
            )
            .wrap()
            .w_full(),
        );
    let mut actions = responsive_row(narrow).child(
        Button::new("Send question")
            .variant(ButtonVariant::Contrast)
            .disabled(disabled || count == 0 || count > 1000)
            .on_press(|s: &mut State| s.ask_chat())
            .build(k)
            .key("chat-send")
            .h(44.0),
    );
    if s.chat.busy {
        actions = actions.child(button(k, "chat-cancel", "Cancel response", false, |_| {
            host(json!({"type":"chat_cancel"}))
        }));
    }
    actions = actions.child(
        Button::new("New conversation")
            .variant(ButtonVariant::Outline)
            .disabled(
                s.chat.messages.is_empty()
                    && s.chat.pending.is_empty()
                    && s.chat_question.text.is_empty(),
            )
            .on_press(|_: &mut State| host(json!({"type":"chat_clear"})))
            .build(k)
            .key("chat-clear")
            .h(44.0),
    );
    view.child(actions)
}
fn results_view(s: &State, k: &Kit, narrow: bool, wide: bool) -> El {
    let Some(analysis) = &s.analysis else {
        return col()
            .gap(20.0)
            .w_full()
            .child(heading(
                if s.loading {
                    "Updating your strategies…"
                } else {
                    "Ready to explore your strategies?"
                },
                "The analysis recalculates results using your selected priorities and scenario.",
                narrow,
            ))
            .child(parameters_panel(s, k, narrow, None))
            .child(if s.loading {
                button(k, "cancel-priorities", "Cancel analysis", false, |s| {
                    s.page = Page::Setup;
                    host(json!({"type":"cancel"}));
                })
            } else {
                Button::new("Apply scenario")
                    .variant(ButtonVariant::Contrast)
                    .disabled(
                        !s.ready || s.farm.is_none() || s.adjustment_blocked() || s.soil_blocked(),
                    )
                    .on_press(State::analyze)
                    .build(k)
                    .key("apply-scenario")
                    .h(44.0)
            })
            .child(button(
                k,
                "back-setup",
                "← Edit farm and history",
                false,
                |s| s.page = Page::Setup,
            ));
    };
    let mut card_items = vec![];
    for (i, rec) in analysis.recommendations.iter().enumerate() {
        card_items.push(recommendation_card(
            rec,
            SelectedStrategy::Ranked(i),
            k,
            narrow,
            analysis.demo,
        ));
    }
    let columns = if narrow {
        1
    } else if wide {
        3
    } else {
        2
    };
    let mut cards = col().gap(20.0).w_full();
    let mut line = responsive_row(narrow);
    let count = card_items.len();
    for (i, card) in card_items.into_iter().enumerate() {
        line = line.child(card);
        if (i + 1) % columns == 0 || i + 1 == count {
            // Keep a lone final option the same width as the other cards.
            if !narrow && (i + 1) % columns != 0 {
                for _ in (i + 1) % columns..columns {
                    line = line.child(column_width(el(), false, 1.0));
                }
            }
            cards = cards.child(line);
            line = responsive_row(narrow);
        }
    }
    let mut view = col().gap(24.0).w_full()
        .child(button(k, "back-setup", "← Edit farm and history", false, |s| s.page = Page::Setup))
        .child(heading_with_width(if analysis.recommendations.is_empty() { "Let's review your planting options." } else { "Today's highest scores." }, if analysis.recommendations.is_empty() { "The analysis checked planting windows and field restrictions. Review the reasons below and change your options to run another analysis." } else { "Review up to three recommendations based on our data and your field's local information. Compare the scores and choose the best rotation for your farm." }, narrow, true))
        .child(steps(s, narrow))
        .child(presentation_context(s, k, true))
        .child(farm_summary(s))
        .child(analysis_banner(analysis))
        .child(adjustment_banner(analysis))
        .child(if analysis.recommendations.is_empty() { el() } else {
            col().w_full().gap(7.0)
                .child(label("Compare your options", 22.0, 600.0, INK).role("heading").level(2).wrap().w_full())
                .child(paragraph(&analysis.priority_note))
                .child(label("Open any card to explore its crop cycle, benefits and risks. Future scores use the climate projection around 2060.", 12.0, 400.0, MUTED).wrap().w_full())
                .child(if analysis.ranking_note.is_empty() { el() } else {
                    label(&analysis.ranking_note, 12.0, 500.0, INK).wrap().w_full()
                })
        })
        .child(cards);
    if analysis.recommendations.is_empty() {
        view = view.child(panel().child(label("No feasible sequence", 22.0, 600.0, INK).wrap())
            .child(paragraph("No sequence meets the selected planning options and applicable field restrictions. Review the discard reasons, the month when the field becomes available and the number of crops to plan.")));
    } else {
        view = view.child(label("Your current rotation is a reference and may also appear as a suggestion. Cards follow today's scores; future positions may change. Indices are not probabilities.", 11.0, 400.0, MUTED).wrap().w_full());
    }
    view = view.child(
        col()
            .w_full()
            .gap(12.0)
            .child(
                eyebrow("YOUR CURRENT ROTATION · COMPARISON REFERENCE")
                    .wrap()
                    .w_full(),
            )
            .child(
                current_rotation_card(&analysis.current_rotation, k, narrow, analysis.demo)
                    .w_full(),
            ),
    );
    if analysis.recommendations.is_empty() && !analysis.discarded.is_empty() {
        let mut discarded = panel().gap(12.0).child(button(
            k,
            "discarded-toggle",
            &format!(
                "{} {} discarded sequences",
                if s.discarded_open { "Hide" } else { "Show" },
                analysis.discarded.len()
            ),
            false,
            |s| s.discarded_open = !s.discarded_open,
        ));
        if s.discarded_open {
            for reason in &analysis.discarded {
                discarded = discarded.child(paragraph(reason));
            }
        }
        view = view.child(discarded);
    }
    view = view
        .child(parameters_panel(s, k, narrow, Some(analysis)))
        .child(chat_panel(s, k, narrow));
    if s.field_context.is_some() {
        view = view.child(field_panel(s, k, narrow));
    }
    view.child(another_field(k))
}
fn timeline_view(s: &State, k: &Kit, narrow: bool) -> El {
    let Some(analysis) = &s.analysis else {
        return el();
    };
    let selected = match s.selected {
        SelectedStrategy::Ranked(i) => analysis.recommendations.get(i),
        SelectedStrategy::Current => analysis.current_rotation.strategy.as_ref(),
    };
    let Some(rec) = selected else {
        return el();
    };
    let (name, tagline, accent, tint) = category(&rec.category);
    let Some(stage) = rec.timeline.get(s.stage) else {
        return el();
    };
    let mut months = row().gap(4.0).w_full();
    for (i, name) in rec.month_labels.iter().enumerate() {
        let month = (i + 1) as u8;
        let active = month >= stage.start_month && month <= stage.end_month;
        months = months.child(
            col()
                .grow(1.0)
                .gap(8.0)
                .center()
                .child(label(name, 10.0, 500.0, MUTED))
                .child(el().h(12.0).w_full().radius(3.0).fill(color(if active {
                    accent
                } else {
                    "#e5e9dd"
                }))),
        );
    }
    let mut stages = col().gap(9.0);
    for (i, item) in rec.timeline.iter().enumerate() {
        stages = stages.child(
            row()
                .key(format!("stage-{i}"))
                .gap(14.0)
                .padding(14.0)
                .center_y()
                .radius(10.0)
                .fill(color(if i == s.stage { tint } else { "#f7f8f2" }))
                .border(1.0, color(if i == s.stage { accent } else { LINE }))
                .child(label(format!("{:02}", i + 1), 16.0, 500.0, accent))
                .child(
                    col()
                        .gap(4.0)
                        .grow(1.0)
                        .min_w(0.0)
                        .child(label(&item.title, 14.0, 600.0, INK).wrap())
                        .child(label(&item.period, 11.0, 400.0, MUTED)),
                )
                .child(label("→", 18.0, 400.0, accent))
                .role("button")
                .label(format!("Stage {}: {}", i + 1, item.title))
                .hover(color(INK).alpha(0.06))
                .press(color(INK).alpha(0.10))
                .focusable(true)
                .on_press(move |s: &mut State| s.stage = i),
        );
    }
    let detail = panel()
        .gap(18.0)
        .child(pill(&stage.period, tint, accent))
        .child(label(&stage.title, 27.0, 600.0, INK).wrap().w_full())
        .child(paragraph(&stage.description))
        .child(revenue_context(
            &stage.revenue_title,
            &stage.revenue_note,
            false,
        ))
        .child(rule())
        .child(
            col()
                .gap(7.0)
                .child(eyebrow("WATER AND CLIMATE"))
                .child(paragraph(&stage.water)),
        )
        .child(
            col()
                .gap(7.0)
                .child(eyebrow("SOIL AND MANAGEMENT"))
                .child(paragraph(&stage.soil)),
        )
        .child(
            col()
                .gap(7.0)
                .padding(14.0)
                .fill(color("#f5f0e2"))
                .radius(9.0)
                .child(eyebrow("WATCH POINT"))
                .child(paragraph(&stage.risk)),
        );
    let mut facts = col().gap(12.0).w_full();
    let all_facts: Vec<_> = rec
        .rank_facts
        .iter()
        .chain(rec.facts.iter())
        .chain(rec.comparison_facts.iter().skip(1))
        .collect();
    for chunk in all_facts.chunks(3) {
        let mut line = responsive_row(narrow);
        for fact in chunk {
            line = line.child(column_width(
                col()
                    .gap(7.0)
                    .padding(18.0)
                    .radius(12.0)
                    .fill(Color::WHITE)
                    .border(1.0, color(LINE))
                    .child(eyebrow(fact.label.to_uppercase()))
                    .child(label(&fact.value, 16.0, 500.0, INK).wrap().w_full()),
                narrow,
                1.0,
            ));
        }
        facts = facts.child(line);
    }
    let mut water_table = col().gap(10.0).w_full().min_w(730.0);
    let table_row = |values: Vec<&str>, heading: bool| {
        let mut cells = row().w_full().gap(12.0).py(8.0);
        for (i, value) in values.iter().enumerate() {
            cells = cells.child(
                label(*value, 12.0, if heading { 600.0 } else { 400.0 }, INK)
                    .w(0.0)
                    .grow(if i == 0 {
                        1.3
                    } else if i < 3 {
                        0.6
                    } else {
                        1.5
                    })
                    .min_w(0.0)
                    .wrap(),
            );
        }
        cells
    };
    water_table = water_table
        .child(table_row(
            vec![
                "Month",
                "Days",
                "Kc",
                "Rainfall (mm)",
                "Demand (mm)",
                "Deficit (mm)",
            ],
            true,
        ))
        .child(rule());
    for month in &stage.monthly {
        water_table = water_table.child(table_row(
            vec![
                &month.month,
                &month.days,
                &month.kc,
                &month.rain,
                &month.demand,
                &month.deficit,
            ],
            false,
        ));
    }
    col().w_full().gap(22.0).child(button(k, "back-results", "← Compare strategies", false, |s| s.page = Page::Results))
        .child(col().gap(10.0).child(pill(name, tint, accent)).child(label(&rec.crop, if narrow { 33.0 } else { 42.0 }, 600.0, INK).role("heading").level(1).wrap().w_full())
            .child(paragraph(format!("{tagline}. {}", rec.reason))))
        .child(presentation_context(s, k, true))
        .child(farm_summary(s)).child(analysis_banner(analysis)).child(adjustment_banner(analysis)).child(paragraph(&analysis.scenario_note))
        .child(revenue_context("REVENUE CONTEXT", &rec.revenue_note, false))
        .child(if rec.tie_note.is_empty() { el() } else {
            // Card-specific tie first; the shared criterion follows when the engine output has one.
            paragraph(if analysis.ranking_note.is_empty() { rec.tie_note.clone() } else { format!("{}. {}", rec.tie_note, analysis.ranking_note) })
        })
        .child(if rec.model_note.is_empty() { el() } else { paragraph(&rec.model_note) })
        .child(col().gap(13.0).child(label("Your crop cycle, step by step", 22.0, 600.0, INK).wrap())
            .child(paragraph("Select a crop to see its details. Year 1 is the starting year of your plan; the calendar may extend beyond December."))
            .child(el().w_full().scroll_x().child(months.min_w(rec.month_labels.len() as f32 * 83.0))))
        .child(responsive_row(narrow).child(column_width(stages, narrow, 0.8)).child(column_width(detail, narrow, 1.2)))
        .child(col().w_full().gap(8.0)
            .child(label("Full comparison", 24.0, 600.0, INK).role("heading").level(2).wrap().w_full())
            .child(paragraph("Review the full rotation across today's climate, the future projection and the dry-year scenario. Revenue is gross, before costs.")))
        .child(facts)
        .child(paragraph(&analysis.priority_note))
        .child(if analysis.soil_note.is_empty() { el() } else { paragraph(&analysis.soil_note) })
        .child(benefits_panel(rec))
        .child(warnings_panel(rec, narrow))
        .child(exposure_panel(s, rec, narrow))
        .child(panel().child(label("Water, month by month", 22.0, 600.0, INK))
            .child(paragraph(&rec.water_caption))
            .child(el().w_full().scroll_x().child(water_table)))
        .child(panel().gap(8.0).child(eyebrow("WHAT TO CONSIDER IN THIS CHOICE")).child(paragraph(&rec.tradeoff)))
        .child(chat_panel(s, k, narrow))
}
pub(crate) fn view(s: &State, cx: &mut Cx<State>) -> El {
    // Use browser conventions for every control: Tab, Enter and Space.
    cx.web_focus();
    let narrow = cx
        .layout_with("page-root", |rect| rect[2] < 900.0)
        .unwrap_or(false);
    let wide = cx
        .layout_with("page-root", |rect| rect[2] >= 1380.0)
        .unwrap_or(false);
    let kit = Kit::from_palette(PaletteSeed {
        bg: color("#ffffff"),
        fg: color(INK),
        accent: color("#577a3a"),
    });
    let mut overlays = vec![];
    let page = match s.page {
        Page::Setup => setup_view(s, &kit, &mut overlays, narrow),
        Page::Results => results_view(s, &kit, narrow, wide),
        Page::Timeline => timeline_view(s, &kit, narrow),
    };
    let mut content = col()
        .w_full()
        .max_w(1220.0)
        .gap(20.0)
        .padding(if narrow { 18.0 } else { 36.0 })
        .pt(12.0)
        .pb(40.0);
    content = content.child(page);
    if !s.notice.is_empty() {
        content = content.child(label(&s.notice, 10.0, 400.0, MUTED).wrap().w_full());
    }
    if narrow && s.page != Page::Results {
        content = content.child(another_field(&kit));
    }
    let mut main = col()
        .role("main")
        .grow(1.0)
        .min_w(0.0)
        .min_h(0.0)
        .h_full()
        .child(header(s, narrow));
    if s.clear_confirm {
        main = main.child(panel().gap(10.0).child(label("Delete this browser's draft?", 18.0, 600.0, INK).wrap())
            .child(paragraph("Your saved boundary and history entries will be removed. Downloaded GeoJSON files stay with you."))
            .child(row().gap(10.0).child(button(&kit, "confirm-reset", "Delete draft", true, |_| host(json!({"type":"clear"}))))
                .child(button(&kit, "cancel-reset", "Keep draft", false, |s| s.clear_confirm = false))));
    }
    if !s.error.is_empty() {
        main = main.child(
            col()
                .key("error-message")
                .role("alert")
                .padding(14.0)
                .fill(color("#f9e6df"))
                .child(label(&s.error, 13.0, 500.0, "#963e2b").wrap().w_full()),
        );
    }
    main = main.child(
        col()
            .key(format!("scroll-{:?}", s.page))
            .w_full()
            .grow(1.0)
            .min_h(0.0)
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .child(row().w_full().justify_center().child(content))
            .scroll_bar_styled(
                ScrollBarStyle::from_kit(&kit)
                    .always_visible()
                    .thumb(color(MUTED))
                    .thumb_hover(color(INK))
                    .width(8.0)
                    .hover_width(10.0),
            ),
    );
    let mut base = row().key("page-root").w_full().h_full().fill(color(BG));
    if !narrow {
        base = base.child(sidebar(s, &kit));
    }
    // Rune normally keeps a brief color fade under Reduce Motion. Request an
    // instant change explicitly so this optional feedback respects that setting.
    let (hover_enter, hover_exit) = if cx.is_reduced_motion() {
        (Curve::Instant, Curve::Instant)
    } else {
        (
            Curve::tween(0.12, Easing::EASE_OUT),
            Curve::tween(0.16, Easing::EASE_OUT),
        )
    };
    // Color feedback only: hit areas and layout stay still.
    rune_kit::root(
        base.child(main)
            .hover_motion_within(hover_enter, hover_exit),
        overlays,
    )
}
