use crate::{
    State, host,
    model::{Analysis, Farm, Page, Recommendation},
};
use rune::{Color, Cx, El, ScrollSpec, Shape, TextStyle, canvas, col, el, row, text};
use rune_kit::{
    Button, ButtonVariant, Card, ControlSize, Kit, PaletteSeed, Select, SelectAppearance, TextInput,
};
use serde_json::json;

const BG: &str = "#f5f5ee";
const INK: &str = "#193d30";
const MUTED: &str = "#68766a";
const LINE: &str = "#e0e6da";
const MONTHS: &[&str] = &[
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
];
const HORIZONS: &[&str] = &["Próxima cultura", "Próximas duas culturas"];

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
                .child(label("CULTIVE POSSIBILIDADES", 8.0, 500.0, "#b4c7ae")),
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
                .child(label("SEU PLANEJAMENTO", 9.0, 600.0, "#9cb299").mb(9.0))
                .child(nav(
                    "nav-farm",
                    "01",
                    "Sua fazenda",
                    s.page == Page::Setup,
                    true,
                    Page::Setup,
                ))
                .child(nav(
                    "nav-results",
                    "02",
                    "Seus caminhos",
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
                        "O próximo ciclo\ncomeça com uma\nboa escolha.",
                        19.0,
                        500.0,
                        "#e0ebcb",
                    )
                    .wrap(),
                )
                .child(
                    label(
                        "Renda, solo e clima.\nTrês olhares para sua fazenda.",
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
                    "Field Shift · Protótipo v0.1",
                    10.0,
                    400.0,
                    "#8fa58e",
                )),
        )
        .child(
            Button::new("Recomeçar")
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
        "Motor conectado"
    } else {
        "Motor desconectado"
    };
    let head = if narrow {
        logo(true)
    } else {
        row()
            .gap(10.0)
            .center_y()
            .child(label("Seu espaço de cultivo", 13.0, 500.0, INK))
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
                if s.ready { "Conectado" } else { "Sem conexão" }
            } else {
                mode
            },
            if s.ready { "#e1ebd4" } else { "#efe8ce" },
            if s.ready { INK } else { "#75622f" },
        ))
}
fn heading(title: &str, subtitle: &str, narrow: bool) -> El {
    col()
        .gap(10.0)
        .child(eyebrow("PLANEJAMENTO AGRÍCOLA"))
        .child(
            label(title, if narrow { 30.0 } else { 39.0 }, 600.0, INK)
                .wrap()
                .w_full(),
        )
        .child(paragraph(subtitle).max_w(780.0))
}
fn steps(s: &State, narrow: bool) -> El {
    let labels = [
        if narrow { "Área" } else { "Defina sua área" },
        if narrow {
            "Histórico"
        } else {
            "Conte o histórico"
        },
        if narrow {
            "Caminhos"
        } else {
            "Explore os caminhos"
        },
    ];
    let mut line = row().w_full().gap(if narrow { 8.0 } else { 20.0 });
    for (i, title) in labels.iter().enumerate() {
        let active = if s.page == Page::Setup { i < 2 } else { i == 2 };
        line = line.child(
            row()
                .grow(1.0)
                .min_w(0.0)
                .gap(8.0)
                .center_y()
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
                        if narrow { 11.0 } else { 12.0 },
                        500.0,
                        if active { INK } else { MUTED },
                    )
                    .wrap(),
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
                .label("Prévia do contorno da fazenda"),
        )
}
fn farm_panel(s: &State, k: &Kit, narrow: bool) -> El {
    let mut content = panel().child(
        row()
            .center_y()
            .justify_between()
            .child(label("01  A sua fazenda", 19.0, 600.0, INK))
            .child(pill(
                if s.farm.is_some() {
                    "Área definida"
                } else {
                    "Primeiro passo"
                },
                "#eff3e6",
                "#55713e",
            )),
    );
    content = content.child(field_art(s.farm.as_ref()));
    if let Some(farm) = &s.farm {
        content = content.child(row().gap(14.0).center_y().justify_between()
            .child(col().gap(5.0).shrink().child(label(&farm.name, 19.0, 600.0, INK).wrap())
                .child(label(format!("{} vértices · {}", farm.point_count, match farm.source.as_str() { "sample" => "área de exemplo", "import" => "GeoJSON importado", _ => "contorno desenhado" }), 11.0, 400.0, MUTED)))
            .child(col().gap(3.0).child(label(format!("{:.2} ha", farm.area_ha).replace('.', ","), 26.0, 500.0, INK)).child(label("área aproximada", 10.0, 400.0, MUTED))))
            .child(paragraph("O centro do contorno fornece latitude e longitude da análise. A área converte a receita por hectare em receita total."))
            .child(responsive_row(narrow)
                .child(column_width(button(k, "edit-map", "Ver e editar no mapa", false, |_| host(json!({"type":"map"}))), narrow, 1.0))
                .child(column_width(button(k, "download", "Baixar GeoJSON", false, |_| host(json!({"type":"download"}))), narrow, 1.0)))
            .child(Button::new("Importar outro GeoJSON").variant(ButtonVariant::Ghost).on_press(|_: &mut State| host(json!({"type":"import"}))).build(k).key("replace-import").h(40.0));
    } else {
        content = content
            .child(label("Sua área, o ponto de partida.", 20.0, 500.0, INK).wrap())
            .child(paragraph(
                "Desenhe os limites no mapa satélite ou use um arquivo GeoJSON que você já tem.",
            ))
            .child(
                responsive_row(narrow)
                    .child(column_width(
                        button(k, "draw-map", "Desenhar no mapa", true, |_| {
                            host(json!({"type":"map"}))
                        }),
                        narrow,
                        1.0,
                    ))
                    .child(column_width(
                        button(k, "import", "Importar GeoJSON", false, |_| {
                            host(json!({"type":"import"}))
                        }),
                        narrow,
                        1.0,
                    )),
            )
            .child(
                responsive_row(narrow)
                    .gap(8.0)
                    .child(label("Polygon ou MultiPolygon · até 2 MB", 10.0, 400.0, MUTED).wrap())
                    .child(
                        Button::new("Usar área de exemplo")
                            .variant(ButtonVariant::Ghost)
                            .on_press(|_: &mut State| host(json!({"type":"sample"})))
                            .build(k)
                            // This Rune revision reserves Enter for the window's default
                            // button. The web example action also accepts focused Enter.
                            .on_key(|_: &mut State, ev, tx| {
                                if ev.key == rune::Key::Enter && ev.mods == rune::Mods::default() {
                                    if !tx.key_repeat() {
                                        host(json!({"type":"sample"}));
                                    }
                                    true
                                } else {
                                    false
                                }
                            })
                            .key("sample")
                            .h(40.0),
                    ),
            );
    }
    column_width(content, narrow, 1.35)
}
fn history_panel(s: &State, k: &Kit, overlays: &mut Vec<El>, narrow: bool) -> El {
    let crops: Vec<String> = s.cultures.iter().map(|c| c.label.clone()).collect();
    let crop = Select::new("crop-select", &crops)
        .appearance(SelectAppearance::Field)
        .placeholder("Selecione a cultura")
        .label("Cultura anterior")
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
        .child(row().center_y().justify_between().child(label("02  O que já foi plantado?", 18.0, 600.0, INK).wrap().shrink())
            .child(pill("Opcional", "#f0f1ea", MUTED)))
        .child(paragraph("Adicione da cultura mais antiga à mais recente. A última será a cultura anterior para o motor. Você pode seguir sem histórico."))
        .child(label("Safras e observações ficam no rascunho; o motor recebe apenas a ordem das culturas.", 11.0, 400.0, MUTED).wrap().w_full())
        .child(col().gap(6.0).child(eyebrow("CULTURA ANTERIOR")).child(crop));
    content = content
        .child(
            col().gap(6.0).child(eyebrow("SAFRA / ANO")).child(
                TextInput::new(&s.season)
                    .placeholder("Ex.: 2025/26")
                    .label("Safra ou ano")
                    .width(None)
                    .height(44.0)
                    .on_edit(|s: &mut State| &mut s.season)
                    .build(k)
                    .key("season")
                    .w_full(),
            ),
        )
        .child(
            col().gap(6.0).child(eyebrow("OBSERVAÇÃO OPCIONAL")).child(
                TextInput::new(&s.notes)
                    .placeholder("Ex.: pouca chuva no fim do ciclo")
                    .label("Observações da safra")
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
                "+ Adicionar ao histórico",
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
                            " · mais recente"
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
                            .label("Mover cultura para antes")
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
                            .label("Mover cultura para depois")
                            .h(40.0),
                    )
                    .child(
                        Button::new("Remover")
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
                "Nenhum registro. Você pode continuar assim.",
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
    let mut view = col().w_full().gap(25.0)
        .child(heading("Qual será o seu próximo ciclo?", "Comece pela sua fazenda. Depois, explore as possibilidades para produzir, cuidar do solo e se adaptar ao clima.", narrow))
        .child(steps(s, narrow))
        .child(responsive_row(narrow).child(farm_panel(s, k, narrow)).child(history_panel(s, k, overlays, narrow)))
        .child(planning_panel(s, k, overlays, narrow));
    let action = Button::new(if s.loading {
        "Analisando…"
    } else {
        "Analisar fazenda  →"
    })
    .variant(ButtonVariant::Contrast)
    .control_size(ControlSize::ExtraLarge)
    .disabled(s.farm.is_none() || s.loading || !s.ready)
    .on_press(State::analyze)
    .build(k)
    .key("analyze")
    .h(50.0)
    .min_w(if narrow { 0.0 } else { 240.0 });
    let summary = if s.farm.is_none() {
        "Defina uma área para continuar.".into()
    } else if s.history.is_empty() {
        "Área pronta · análise sem histórico de plantio".into()
    } else {
        format!("Área pronta · {} registro(s) de plantio", s.history.len())
    };
    view = view.child(
        responsive_row(narrow)
            .center_y()
            .child(
                col()
                    .gap(5.0)
                    .grow(if narrow { 0.0 } else { 1.0 })
                    .child(label(summary, 13.0, 500.0, INK).wrap())
                    .child(
                        label(
                            "Localização, ordem das culturas e opções do ciclo serão enviadas para a análise.",
                            11.0,
                            400.0,
                            MUTED,
                        )
                        .wrap(),
                    ),
            )
            .child(if narrow { action.w_full() } else { action }),
    );
    if s.loading {
        view = view.child(button(k, "cancel", "Cancelar análise", false, |_| {
            host(json!({"type":"cancel"}))
        }));
    }
    if !s.ready {
        view = view.child(button(k, "reconnect", "Reconectar ao motor", false, |_| {
            host(json!({"type":"connect"}))
        }));
    }
    if s.farm.is_some() {
        view = view.child(field_panel(s, k, narrow));
    }
    view
}
fn field_panel(s: &State, k: &Kit, narrow: bool) -> El {
    let mut view = panel()
        .w_full()
        .child(label("Seu talhão", 23.0, 600.0, INK));
    let Some(field) = &s.field_context else {
        return view.child(paragraph("As observações de vegetação e relevo estão disponíveis apenas para o contorno do talhão de demonstração. Ainda não há esses dados para esta área."));
    };
    view = view
        .child(pill("TALHÃO DE DEMONSTRAÇÃO", "#e9efd9", INK))
        .child(paragraph(&field.summary))
        .child(button(
            k,
            "field-toggle",
            if s.field_open {
                "Ocultar observações do talhão"
            } else {
                "Mostrar observações do talhão"
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
    view.child(label("Vegetação ao longo do ano", 18.0, 600.0, INK))
        .child(paragraph("Barras: NDVI médio mensal, escala de 0 a 1 neste talhão. Percentuais abaixo dos meses: frequência de indício de solo descoberto ou palhada. Deslize para ver os 12 meses."))
        .child(el().w_full().scroll_x().child(chart))
        .child(paragraph(&field.coverage))
        .child(rule())
        .child(responsive_row(narrow)
            .child(column_width(col().gap(8.0).child(eyebrow("RELEVO")).child(paragraph(&field.terrain)), narrow, 1.0))
            .child(column_width(col().gap(8.0).child(eyebrow("SATÉLITE + ESTAÇÃO EM SOLO")).child(paragraph(&field.station)), narrow, 1.0)))
        .child(col().gap(8.0).padding(14.0).radius(9.0).fill(color("#eaf1ef"))
            .child(eyebrow("O QUE MUDA ENTRE OS MODELOS CLIMÁTICOS"))
            .child(paragraph(&field.model_spread)))
        .child(label(&field.source, 11.0, 400.0, MUTED).wrap().w_full())
}
fn glossary(s: &State, k: &Kit) -> El {
    let mut view = panel().w_full().gap(14.0)
        .child(button(k, "glossary-toggle", if s.glossary_open { "Entenda os termos · recolher" } else { "Entenda os termos · abrir" }, false, |s| s.glossary_open = !s.glossary_open))
        .child(label("Escopo: um talhão. As fontes têm resoluções diferentes: clima de um ponto, NDVI de 250 m e altitude de 30 m. Vegetação e relevo estão disponíveis para a área de demonstração.", 11.0, 400.0, MUTED).wrap().w_full());
    if s.glossary_open {
        for (term, definition) in [
            (
                "Evapotranspiração",
                "Água que sai do solo e das plantas para a atmosfera. ET0 é a demanda de referência; ETc é a demanda estimada da cultura, calculada com seu Kc. Valores em milímetros.",
            ),
            (
                "Kc",
                "Coeficiente da cultura: multiplica a ET0 para estimar a ETc. Muda ao longo do ciclo; não é uma quantidade de água.",
            ),
            (
                "Déficit",
                "Parte da demanda de água que a chuva e a reserva de água do solo não conseguem atender no balanço do motor. É uma estimativa em milímetros, não uma prescrição de irrigação.",
            ),
            (
                "Atendimento hídrico",
                "Quanto da demanda foi atendida no balanço estimado. A tela mostra um índice de 0 a 100; maior significa menos demanda não atendida, não uma chance de sucesso.",
            ),
            (
                "NDVI",
                "Índice de vegetação calculado a partir da luz refletida pela superfície. Varia de −1 a 1. Valores maiores costumam indicar vegetação mais verde; valores baixos também podem ser palhada ou solo exposto. Não mede a saúde do solo diretamente.",
            ),
            (
                "Encaixe",
                "Adequação da sequência às condições de temperatura, chuva e calor usadas pelo motor. A sequência fica limitada pelo menor encaixe de suas culturas. Índice de 0 a 100, não probabilidade de resistir a eventos extremos.",
            ),
        ] {
            view = view.child(
                col()
                    .gap(5.0)
                    .child(label(term, 15.0, 600.0, INK))
                    .child(paragraph(definition)),
            );
        }
        view = view.child(rule())
            .child(label("Valide com seu agrônomo", 17.0, 600.0, INK))
            .child(paragraph("Receitas são brutas, sem custos; preços históricos e valores ainda marcados para conferência precisam de validação local. Limites de calor variam com cultivar e fase da planta. Sem limiar cadastrado, o motor não penaliza o calor; isso não comprova tolerância."))
            .child(paragraph("As constantes ainda são provisórias: reserva de água do solo de 100 mm, fator 0,85 para repetição e 1,10 após fixadora de nitrogênio, pesos de solo 0,4/0,4/0,2, fases de Kc em 20%/45%/80% do ciclo, intervalo de colheita de 10 dias, espera máxima de 182 dias e perda proporcional de 1 para 1 pelos dias de calor na fase de 45% a 80% do ciclo. Elas não substituem medições nem recomendação agronômica."));
    }
    view
}
fn planning_panel(s: &State, k: &Kit, overlays: &mut Vec<El>, narrow: bool) -> El {
    let month = Select::new("month-select", MONTHS)
        .appearance(SelectAppearance::Field)
        .label("Mês em que o talhão fica livre")
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
        .label("Quantidade de culturas a planejar")
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
    panel().child(label("03  Seu próximo ciclo", 19.0, 600.0, INK))
        .child(responsive_row(narrow)
            .child(column_width(col().gap(8.0).child(eyebrow("TALHÃO LIVRE A PARTIR DE")).child(month), narrow, 1.0))
            .child(column_width(col().gap(8.0).child(eyebrow("O QUE PLANEJAR")).child(horizon), narrow, 1.0)))
        .child(paragraph("O calendário considera o talhão livre no dia 1 desse mês. O motor verifica as épocas de plantio de cada cultura."))
        .child(col().padding(14.0).gap(6.0).radius(10.0).fill(color("#f5f0e2"))
            .child(eyebrow("BASE CLIMÁTICA DESTE TESTE"))
            .child(paragraph(if s.data_notice.is_empty() { "Conecte ao motor para consultar o catálogo de culturas e a origem dos dados." } else { &s.data_notice })))
}
fn category(category: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match category {
        "income" => ("MAIOR RENDA", "Produzir com retorno", "#a47930", "#f3ebd7"),
        "soil" => ("SAÚDE DO SOLO", "Cuidar da base", "#5d7d38", "#e9efd9"),
        _ => (
            "RESILIÊNCIA CLIMÁTICA",
            "Adaptar para seguir",
            "#4d7c88",
            "#e4eff0",
        ),
    }
}
fn recommendation_card(rec: &Recommendation, i: usize, k: &Kit, narrow: bool, demo: bool) -> El {
    let (name, tagline, accent, tint) = category(&rec.category);
    let body = col()
        .gap(18.0)
        .child(
            row()
                .center_y()
                .justify_between()
                .child(pill(name, tint, accent))
                .child(label(format!("0{}", i + 1), 15.0, 400.0, accent)),
        )
        .child(label(tagline, 12.0, 400.0, MUTED))
        .child(label(&rec.crop, 25.0, 600.0, INK).wrap().w_full())
        .child(
            col()
                .gap(5.0)
                .py(16.0)
                .child(label(&rec.metric, 25.0, 500.0, accent).wrap().w_full())
                .child(label(&rec.metric_label, 10.0, 400.0, MUTED).wrap().w_full()),
        )
        .child(rule())
        .child(paragraph(&rec.reason))
        .child(label(
            if demo {
                "EXEMPLO ILUSTRATIVO"
            } else {
                "RESULTADO DO MOTOR"
            },
            9.0,
            600.0,
            MUTED,
        ))
        .child(
            row()
                .center_y()
                .justify_between()
                .pt(8.0)
                .child(label("Explorar linha do tempo", 12.0, 600.0, INK))
                .child(label("→", 22.0, 400.0, accent)),
        );
    column_width(
        Card::new()
            .accent(color(accent))
            .child(body)
            .build(k)
            .key(format!("card-{}", rec.category))
            .fill(Color::WHITE)
            .padding(18.0)
            .radius(14.0)
            .border(1.0, color(LINE))
            .role("button")
            .label(format!("{}: {}. Abrir linha do tempo", name, rec.crop))
            .focusable(true)
            .on_press(move |s: &mut State| s.select(i)),
        narrow,
        1.0,
    )
}
fn analysis_banner(analysis: &Analysis) -> El {
    col()
        .gap(7.0)
        .padding(16.0)
        .radius(10.0)
        .fill(color(if analysis.demo { "#f1ecd9" } else { "#e8eedf" }))
        .child(
            label(
                if analysis.demo {
                    "EXEMPLO FIXO DO MOTOR"
                } else {
                    "ANÁLISE DO MOTOR"
                },
                10.0,
                600.0,
                if analysis.demo { "#776333" } else { INK },
            )
            .wrap()
            .w_full(),
        )
        .child(label(&analysis.summary, 12.0, 400.0, MUTED).wrap().w_full())
}
fn farm_summary(s: &State) -> El {
    let Some(farm) = &s.farm else {
        return el();
    };
    label(
        format!(
            "{}  /  {:.2} ha  /  {}",
            farm.name,
            farm.area_ha,
            if s.history.is_empty() {
                "sem histórico".into()
            } else {
                format!("{} safra(s) informada(s)", s.history.len())
            }
        ),
        12.0,
        500.0,
        MUTED,
    )
    .wrap()
    .w_full()
}
fn results_view(s: &State, k: &Kit, narrow: bool) -> El {
    let Some(analysis) = &s.analysis else {
        return el();
    };
    let mut cards = responsive_row(narrow);
    for (i, rec) in analysis.recommendations.iter().enumerate() {
        cards = cards.child(recommendation_card(rec, i, k, narrow, analysis.demo));
    }
    let mut view = col().gap(24.0).w_full()
        .child(button(k, "back-setup", "← Editar fazenda e histórico", false, |s| s.page = Page::Setup))
        .child(heading(if analysis.recommendations.is_empty() { "Vamos ajustar o calendário?" } else { "Três caminhos. A sua escolha." }, if analysis.recommendations.is_empty() { "O motor verificou as épocas de plantio. Confira os motivos abaixo e ajuste as opções para uma nova análise." } else { "Compare o que cada alternativa prioriza. Abra um caminho para entender sua sequência, os cuidados e os pontos de atenção." }, narrow))
        .child(farm_summary(s)).child(analysis_banner(analysis))
        .child(paragraph(&analysis.scenario_note));
    if analysis.recommendations.is_empty() {
        view = view.child(panel().child(label("Nenhuma sequência viável", 22.0, 600.0, INK).wrap())
            .child(paragraph("As épocas de plantio não couberam nas opções informadas. Revise o mês em que o talhão fica livre e a quantidade de culturas no planejamento.")));
    } else {
        view = view.child(cards).child(label("Uma mesma sequência pode vencer mais de um objetivo. Os índices de solo e clima vão de 0 a 100; não representam probabilidades.", 11.0, 400.0, MUTED).wrap().w_full());
    }
    if !analysis.discarded.is_empty() {
        let mut discarded = panel().gap(12.0).child(button(
            k,
            "discarded-toggle",
            &format!(
                "{} {} sequências descartadas",
                if s.discarded_open { "Ocultar" } else { "Ver" },
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
    if s.farm.is_some() {
        view = view.child(field_panel(s, k, narrow));
    }
    view
}
fn timeline_view(s: &State, k: &Kit, narrow: bool) -> El {
    let Some(analysis) = &s.analysis else {
        return el();
    };
    let Some(rec) = analysis.recommendations.get(s.selected) else {
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
                .label(format!("Etapa {}: {}", i + 1, item.title))
                .focusable(true)
                .on_press(move |s: &mut State| s.stage = i),
        );
    }
    let detail = panel()
        .gap(18.0)
        .child(pill(&stage.period, tint, accent))
        .child(label(&stage.title, 27.0, 600.0, INK).wrap().w_full())
        .child(paragraph(&stage.description))
        .child(rule())
        .child(
            col()
                .gap(7.0)
                .child(eyebrow("ÁGUA E CLIMA"))
                .child(paragraph(&stage.water)),
        )
        .child(
            col()
                .gap(7.0)
                .child(eyebrow("SOLO E MANEJO"))
                .child(paragraph(&stage.soil)),
        )
        .child(
            col()
                .gap(7.0)
                .padding(14.0)
                .fill(color("#f5f0e2"))
                .radius(9.0)
                .child(eyebrow("PONTO DE ATENÇÃO"))
                .child(paragraph(&stage.risk)),
        );
    let mut facts = col().gap(12.0).w_full();
    for chunk in rec.facts.chunks(3) {
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
                "Mês",
                "Dias",
                "Kc",
                "Chuva (mm)",
                "Demanda (mm)",
                "Déficit (mm)",
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
    col().w_full().gap(22.0).child(button(k, "back-results", "← Comparar os três caminhos", false, |s| s.page = Page::Results))
        .child(col().gap(10.0).child(pill(name, tint, accent)).child(label(&rec.crop, if narrow { 33.0 } else { 42.0 }, 600.0, INK).wrap().w_full())
            .child(paragraph(format!("{tagline}. {}", rec.reason))))
        .child(farm_summary(s)).child(analysis_banner(analysis)).child(paragraph(&analysis.scenario_note)).child(facts)
        .child(col().gap(13.0).child(label("Seu ciclo, etapa por etapa", 22.0, 600.0, INK).wrap())
            .child(paragraph("Selecione uma cultura para ver os detalhes. Ano 1 é o ano inicial do planejamento; o calendário pode atravessar dezembro."))
            .child(el().w_full().scroll_x().child(months.min_w(rec.month_labels.len() as f32 * 83.0))))
        .child(responsive_row(narrow).child(column_width(stages, narrow, 0.8)).child(column_width(detail, narrow, 1.2)))
        .child(panel().child(label("Água, mês a mês", 22.0, 600.0, INK))
            .child(paragraph(&rec.water_caption))
            .child(el().w_full().scroll_x().child(water_table)))
        .child(panel().gap(8.0).child(eyebrow("O QUE CONSIDERAR NESTA ESCOLHA")).child(paragraph(&rec.tradeoff)))
}
pub(crate) fn view(s: &State, cx: &mut Cx<State>) -> El {
    let narrow = cx
        .layout_with("page-root", |rect| rect[2] < 900.0)
        .unwrap_or(false);
    let kit = Kit::from_palette(PaletteSeed {
        bg: color("#ffffff"),
        fg: color(INK),
        accent: color("#577a3a"),
    });
    let mut overlays = vec![];
    let page = match s.page {
        Page::Setup => setup_view(s, &kit, &mut overlays, narrow),
        Page::Results => results_view(s, &kit, narrow),
        Page::Timeline => timeline_view(s, &kit, narrow),
    };
    let mut content = col()
        .w_full()
        .max_w(1220.0)
        .gap(20.0)
        .padding(if narrow { 18.0 } else { 36.0 })
        .pt(12.0)
        .pb(40.0);
    content = content.child(page).child(glossary(s, &kit));
    if !s.notice.is_empty() {
        content = content.child(label(&s.notice, 10.0, 400.0, MUTED).wrap().w_full());
    }
    if narrow {
        content = content.child(
            Button::new("Recomeçar planejamento")
                .variant(ButtonVariant::Ghost)
                .on_press(|s: &mut State| s.clear_confirm = true)
                .build(&kit)
                .key("reset-mobile")
                .h(44.0),
        );
    }
    let mut main = col()
        .grow(1.0)
        .min_w(0.0)
        .min_h(0.0)
        .h_full()
        .child(header(s, narrow));
    if s.clear_confirm {
        main = main.child(panel().gap(10.0).child(label("Apagar o rascunho deste navegador?", 18.0, 600.0, INK).wrap())
            .child(paragraph("O contorno e os registros salvos serão removidos. Arquivos GeoJSON baixados continuam com você."))
            .child(row().gap(10.0).child(button(&kit, "confirm-reset", "Apagar rascunho", true, |_| host(json!({"type":"clear"}))))
                .child(button(&kit, "cancel-reset", "Manter", false, |s| s.clear_confirm = false))));
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
            .child(row().w_full().justify_center().child(content)),
    );
    let mut base = row().key("page-root").w_full().h_full().fill(color(BG));
    if !narrow {
        base = base.child(sidebar(s, &kit));
    }
    rune_kit::root(base.child(main), overlays)
}
