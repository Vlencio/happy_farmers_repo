use crate::{
    State, host,
    model::{
        Adjustment, Analysis, CurrentRotation, Farm, Page, Recommendation, SelectedStrategy,
        StrategyWarning,
    },
};
use rune::{Color, Cx, El, ScrollSpec, Shape, TextStyle, canvas, col, el, row, text};
use rune_kit::{
    Button, ButtonVariant, Card, ControlSize, Kit, PaletteSeed, Select, SelectAppearance, TextArea,
    TextInput,
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
                .role("heading")
                .level(1)
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
            .gap(8.0)
            .child(label("01  A sua fazenda", 19.0, 600.0, INK).wrap().shrink())
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
    if let Some(farm) = &s.farm {
        let mut preview = el()
            .key("farm-satellite-preview")
            .w_full()
            .h(if narrow { 220.0 } else { 240.0 })
            .radius(10.0)
            .fill(color("#e7ecdd"))
            .role("img")
            .label(format!("Mapa satélite com o contorno de {}", farm.name))
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
                "Imagem © Esri, Vantor, Earthstar Geographics e comunidade GIS",
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
    } else {
        content = content.child(field_art(None));
    }
    if let Some(farm) = &s.farm {
        let stacked = narrow || farm.name.chars().count() > 36;
        content = content.child(responsive_row(stacked).gap(14.0).center_y().justify_between()
            .child(column_width(col().gap(5.0).child(label(&farm.name, 19.0, 600.0, INK).wrap().w_full())
                .child(label(format!("{} vértices · {}", farm.point_count, match farm.source.as_str() { "sample" => "área de exemplo", "import" => "GeoJSON importado", _ => "contorno desenhado" }), 11.0, 400.0, MUTED).wrap().w_full()), stacked, 1.0))
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
    view = view.child(priorities_panel(s, k, narrow));
    view = view.child(scenario_panel(s, k, narrow));
    let action = Button::new(if s.loading {
        "Analisando…"
    } else {
        "Analisar fazenda  →"
    })
    .variant(ButtonVariant::Contrast)
    .control_size(ControlSize::ExtraLarge)
    .disabled(s.farm.is_none() || s.loading || !s.ready || s.adjustment_blocked())
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
        view = view.child(paragraph("Consultando o clima e calculando os caminhos. A primeira consulta ao POWER pode levar alguns minutos; o limite de espera é de 6 minutos. Você pode cancelar e continuar editando."));
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
            .child(paragraph("A reserva de água do solo usada pelo motor é de 60 mm, uma referência provisória para o cálculo, não uma medição deste talhão. Outras constantes ainda são provisórias: fator 0,85 para repetição e 1,10 após fixadora de nitrogênio, pesos de solo 0,4/0,4/0,2, fases de Kc em 20%/45%/80% do ciclo, intervalo de colheita de 10 dias, espera máxima de 182 dias e perda proporcional de 1 para 1 pelos dias de calor na fase de 45% a 80% do ciclo. Elas não substituem medições nem recomendação agronômica."));
    }
    view
}
fn priorities_panel(s: &State, _: &Kit, narrow: bool) -> El {
    let weights = s.settings.prioridades;
    let mut view = panel().gap(16.0).w_full()
        .child(label("Suas prioridades", 19.0, 600.0, INK).wrap().w_full().role("heading").level(2))
        .child(paragraph("Escolha quanto cada parte deve pesar na pontuação. Zero tira seu peso da pontuação; não exclui culturas."));
    for (index, name, description, selected) in [
        (
            0,
            "Água",
            "Atendimento à necessidade de água das culturas",
            weights.agua,
        ),
        (
            1,
            "Solo",
            "Cobertura, fixação de nitrogênio e diversidade",
            weights.solo,
        ),
        (
            2,
            "Renda",
            "Receita bruta por ano de ocupação, sem descontar custos",
            weights.renda,
        ),
    ] {
        let mut choices = row().gap(6.0).w_full();
        for (value, title) in [(0, "nada"), (1, "pouco"), (2, "médio"), (3, "muito")] {
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
                    .child(label(
                        format!("{value} {title}"),
                        11.0,
                        600.0,
                        if chosen { "#ffffff" } else { INK },
                    ))
                    .role("button")
                    .label(format!(
                        "{name}: prioridade {value} ({title}){}",
                        if chosen { ", selecionada" } else { "" }
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
    if weights.agua == 0 && weights.solo == 0 && weights.renda == 0 {
        view = view.child(paragraph(
            "Tudo em zero: o motor usa pesos iguais para água, solo e renda.",
        ));
    }
    if s.page != Page::Setup {
        view = view.child(label("Mudar uma prioridade refaz a análise e reinicia o chat. Em empate de pontuação, o motor considera a média de água, solo e renda.", 12.0, 400.0, MUTED).wrap().w_full());
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
            .replace('.', ",")
    };
    format!("{number}{unit}")
}
fn scenario_control(s: &State, k: &Kit, field: usize) -> El {
    let adjustment = s.adjustment_preview.unwrap_or(s.settings.ajuste);
    let (name, value, min, max, step, unit, down, up) = if field == 0 {
        (
            "Chuva",
            adjustment.chuva_pct,
            -50.0,
            30.0,
            5.0,
            "%",
            "Diminuir chuva em 5%",
            "Aumentar chuva em 5%",
        )
    } else {
        (
            "Temperatura",
            adjustment.temp_c,
            0.0,
            4.0,
            0.5,
            " °C",
            "Diminuir temperatura em 0,5 °C",
            "Aumentar temperatura em 0,5 °C",
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
        .label(format!(
            "{name} do cenário: {}",
            scenario_value(value, unit)
        ))
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
    let mut view = panel().key("scenario-panel").w_full().gap(16.0)
        .child(label("Simule outro clima", 19.0, 600.0, INK).wrap().w_full().role("heading").level(2))
        .child(paragraph("E se chover menos ou fizer mais calor? É uma simulação, não uma previsão. O mesmo ajuste vale para todos os meses dos cenários de hoje, futuro e ano seco, quando disponível."))
        .child(responsive_row(narrow)
            .child(column_width(scenario_control(s, k, 0), narrow, 1.0))
            .child(column_width(scenario_control(s, k, 1), narrow, 1.0)));
    if !s.scenario_available {
        view = view.child(paragraph(
            "Os ajustes de cenário ainda não estão disponíveis neste servidor.",
        ));
    } else {
        view = view.child(label("Arraste os controles ou use − e +. No teclado, use as setas, Home e End. Ajuste a chuva de 5 em 5% e a temperatura de 0,5 em 0,5 °C; depois aplique para recalcular.", 12.0, 400.0, MUTED).wrap().w_full());
    }
    if s.adjustment_blocked() {
        let message = "Seu rascunho tem um cenário ajustado. Volte ao clima sem ajuste para analisar neste servidor; os valores não serão ignorados.";
        view = view.child(col().role("alert").label(message).child(paragraph(message)));
    }
    view = view.child(
        Button::new("Voltar ao clima sem ajuste")
            .variant(ButtonVariant::Outline)
            .disabled(!s.settings.ajuste.active())
            .on_press(|s: &mut State| s.save_adjustment(Adjustment::default()))
            .build(k)
            .key("scenario-reset")
            .h(44.0)
            .w_full(),
    );
    if s.page != Page::Setup {
        view = view.child(label("Ao mudar o cenário, a análise anterior e o chat são reiniciados. Use Aplicar cenário para consultar os novos resultados.", 12.0, 400.0, MUTED).wrap().w_full());
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
        .child(eyebrow("CENÁRIO HIPOTÉTICO"))
        .child(paragraph(&analysis.adjustment_note))
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
        "current" => (
            "ROTAÇÃO ATUAL",
            "Sua referência de comparação",
            "#71624a",
            "#f0ebe2",
        ),
        "rank1" => (
            "1ª DE HOJE",
            "Maior pontuação com suas prioridades",
            "#a47930",
            "#f3ebd7",
        ),
        "rank2" => (
            "2ª DE HOJE",
            "Segunda maior pontuação",
            "#5d7d38",
            "#e9efd9",
        ),
        _ => (
            "3ª DE HOJE",
            "Terceira maior pontuação",
            "#4d7c88",
            "#e4eff0",
        ),
    }
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
        || "Avisos indisponíveis nesta resposta do motor.".to_owned(),
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
        || "Benefícios indisponíveis nesta resposta do motor.".to_owned(),
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
    let mut metrics = col().gap(13.0).w_full().py(10.0);
    for fact in &rec.comparison_facts {
        metrics = metrics.child(
            col()
                .gap(4.0)
                .w_full()
                .child(label(&fact.label, 11.0, 400.0, MUTED).wrap().w_full())
                .child(label(&fact.value, 22.0, 600.0, INK).wrap().w_full()),
        );
    }
    let mut rankings = col()
        .gap(12.0)
        .w_full()
        .padding(10.0)
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
                "Solo entre culturas: dados indisponíveis nesta análise.",
                11.0,
                400.0,
                MUTED,
            )
            .wrap()
            .w_full(),
        );
    }
    let body = col()
        .gap(18.0)
        .child(
            row()
                .center_y()
                .justify_between()
                .child(pill(name, tint, accent))
                .child(label(marker, 12.0, 400.0, accent)),
        )
        .child(label(tagline, 12.0, 400.0, MUTED).wrap().w_full())
        .child(label(&rec.crop, 25.0, 600.0, INK).wrap().w_full())
        .child(rankings)
        .child(metrics)
        .child(exposure_summary)
        .child(rule())
        .child(paragraph(&rec.reason))
        .child(benefits_card(rec))
        .child(warnings_card(rec))
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
            .label(format!(
                "{}: {}. {}. {} {} Abrir linha do tempo",
                name, rec.crop, comparison_label, benefits_label, warnings_label
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
                "Avisos indisponíveis nesta resposta do motor.",
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
                label("Isso não garante ausência de risco.", 11.0, 400.0, MUTED)
                    .wrap()
                    .w_full(),
            );
    }
    for (title, items, ink, bg) in [
        ("Riscos", &warnings.risks, "#855535", "#f6f0e6"),
        ("Lacunas", &warnings.gaps, "#416773", "#edf3f4"),
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
                    .map_or("Nenhum aviso sinalizado.", |warning| &warning.card_summary),
                12.0,
                400.0,
                INK,
            )
            .wrap()
            .w_full(),
        );
        if items.len() > 1 {
            group = group.child(
                label(format!("+{} no detalhe", items.len() - 1), 11.0, 500.0, ink)
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
                "Benefícios indisponíveis nesta resposta do motor.",
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
                format!("Benefícios · {}", benefits.items.len()),
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
                format!("+{} no detalhe", benefits.items.len() - 1),
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
        label("Benefícios considerados pelo motor", 22.0, 600.0, INK)
            .wrap()
            .w_full()
            .role("heading")
            .level(2),
    );
    let Some(benefits) = &rec.benefits else {
        return view.child(paragraph(
            "Benefícios indisponíveis nesta resposta do motor.",
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
                    label(
                        format!("Dado do motor: {}", item.evidence),
                        12.0,
                        500.0,
                        INK,
                    )
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
        return group.child(paragraph("Nenhum aviso desse tipo sinalizado pelo motor."));
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
                        format!("Dado do motor: {}", warning.evidence),
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
        label("Riscos e lacunas desta estratégia", 22.0, 600.0, INK)
            .wrap()
            .w_full()
            .role("heading")
            .level(2),
    );
    let Some(warnings) = &rec.warnings else {
        return view.child(paragraph("Avisos indisponíveis nesta resposta do motor."))
            .child(paragraph("A resposta não trouxe a lista de avisos desta sequência. Isso não significa ausência de riscos ou de informações a conferir."));
    };
    view = view.child(paragraph(&warnings.summary));
    if !warnings.risks.is_empty() || !warnings.gaps.is_empty() {
        view = view.child(
            responsive_row(narrow)
                .child(column_width(
                    warning_group("Riscos para revisar", &warnings.risks, "#855535", "#f6f0e6"),
                    narrow,
                    1.0,
                ))
                .child(column_width(
                    warning_group(
                        "Lacunas de informação",
                        &warnings.gaps,
                        "#416773",
                        "#edf3f4",
                    ),
                    narrow,
                    1.0,
                )),
        );
    }
    view.child(label(&warnings.note, 12.0, 400.0, MUTED).wrap().w_full())
}
fn exposure_panel(s: &State, rec: &Recommendation, narrow: bool) -> El {
    let mut view = panel().gap(16.0).w_full().child(
        label("Solo entre as culturas", 22.0, 600.0, INK)
            .role("heading")
            .level(2)
            .wrap()
            .w_full(),
    );
    let Some(exposure) = &rec.exposure else {
        return view.child(paragraph("Os dados de dias sem cultura e de chuva sobre solo exposto não estão disponíveis nesta análise."));
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
        ("Com cultura em pé", "#6f8e50"),
        ("Sem cultura · com palhada", "#c8a866"),
        ("Exposto · sem palhada", "#b26a43"),
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
                    label(format!("{} d sem cultura", month.days), 10.0, 400.0, MUTED)
                        .wrap()
                        .w_full(),
                )
                .child(
                    label(
                        format!("{} d expostos", month.exposed_days),
                        10.0,
                        600.0,
                        "#855535",
                    )
                    .wrap()
                    .w_full(),
                )
                .role("button")
                .label(format!(
                    "Solo em {}: {} dias sem cultura, {} dias expostos",
                    month.label, month.days, month.exposed_days
                ))
                .focusable(true)
                .on_press(move |s: &mut State| s.exposure_month = i),
        );
    }
    view = view.child(legend)
        .child(paragraph("Selecione um mês para conferir a chuva. Deslize o calendário para ver os 12 meses; as barras mostram proporções de dias, não a data exata de cada intervalo."))
        .child(el().key("exposure-calendar").w_full().scroll_x().child(calendar));
    if let Some(month) = exposure.months.get(s.exposure_month) {
        view = view.child(col().key("exposure-month-detail").gap(10.0).padding(16.0)
            .radius(10.0).fill(color("#f6f0e6"))
            .child(label(format!("Solo em {}", month.label), 18.0, 600.0, INK).role("heading").level(3).wrap().w_full())
            .child(paragraph(format!("{} dias sem cultura em pé; desses, {} dias expostos sem palhada e {} dias com palhada estimada.", month.days, month.exposed_days, month.days - month.exposed_days)))
            .child(paragraph(format!("Chuva nos dias sem cultura: {}. Chuva nos dias expostos: {}.", month.rain, month.exposed_rain)))
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
        "no_history" => "HISTÓRICO NÃO INFORMADO",
        "discarded" => "FORA DO CALENDÁRIO",
        _ => "COMPARAÇÃO INDISPONÍVEL",
    };
    column_width(
        panel()
            .padding(18.0)
            .gap(18.0)
            .key("card-current")
            .child(pill("ROTAÇÃO ATUAL", "#f0ebe2", "#71624a"))
            .child(label("Sua referência de comparação", 12.0, 400.0, MUTED))
            .child(label(&current.title, 25.0, 600.0, INK).wrap().w_full())
            .child(label(status, 10.0, 600.0, "#71624a").wrap().w_full())
            .child(rule())
            .child(paragraph(&current.description))
            .child(button(
                k,
                "current-edit-history",
                "Revisar histórico e opções",
                false,
                |s| s.page = Page::Setup,
            )),
        narrow,
        1.0,
    )
}
fn analysis_banner(analysis: &Analysis) -> El {
    let mut banner = col()
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
        .child(label(&analysis.summary, 12.0, 400.0, MUTED).wrap().w_full());
    if !analysis.source_warning.is_empty() {
        banner = banner.child(
            col()
                .gap(5.0)
                .padding(12.0)
                .radius(8.0)
                .fill(color("#fff3d7"))
                .child(
                    label("ORIGEM E LIMITES DO CLIMA", 10.0, 600.0, "#72531c")
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
            format!("{:.2}", farm.area_ha).replace('.', ","),
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
fn chat_panel(s: &State, k: &Kit, narrow: bool) -> El {
    if !s.chat.available || s.analysis.is_none() {
        return el();
    }
    let mut view = panel().key("analysis-chat").gap(14.0).w_full()
        .child(label("Converse sobre esta análise", 22.0, 600.0, INK).wrap().w_full().role("heading").level(2))
        .child(paragraph("Tire dúvidas sobre os cards, os benefícios, os riscos e o calendário. A IA explica os resultados do motor."))
        .child(button(k, "chat-toggle", if s.chat_open { "Fechar chat" } else { "Abrir chat com IA" }, false, |s| s.chat_open = !s.chat_open));
    if !s.chat_open {
        return view;
    }
    view = view.child(label("Ao enviar, sua pergunta, a conversa e os dados da análise — incluindo coordenadas e histórico de culturas — são enviados à Anthropic. A conversa fica aberta só nesta sessão e reinicia ao analisar novamente.", 12.0, 400.0, MUTED).wrap().w_full());
    let mut conversation = col().gap(12.0).w_full();
    if s.chat.messages.is_empty() && s.chat.pending.is_empty() {
        conversation = conversation.child(paragraph("Você pode perguntar: “Por que estas estratégias foram sugeridas?” ou “Quais dados preciso conferir antes de decidir?”."));
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
                if producer { "Você" } else { "Assistente IA" },
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
            bubble = bubble.child(label("A IA não respondeu a essa pergunta. Você pode perguntar sobre outro ponto desta análise.", 12.0, 400.0, MUTED).wrap().w_full());
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
                .child(label("Você", 12.0, 600.0, INK))
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
                .label("Ver última resposta")
                .focusable(true)
                .padding(10.0)
                .child(label("Ver última resposta ↓", 12.0, 600.0, INK))
                .on_press_tx(|_: &mut State, tx| tx.scroll_to_bottom("chat-conversation")),
        );
    }
    if s.chat.busy {
        view = view.child(
            col()
                .key("chat-busy")
                .w_full()
                .role("status")
                .label("A IA está preparando a resposta…")
                .child(
                    label("A IA está preparando a resposta…", 13.0, 500.0, INK)
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
                .label("Sua pergunta sobre a análise")
                .placeholder("Escreva sua pergunta…")
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
                format!("{count}/1.000 caracteres · Ctrl+Enter para enviar"),
                11.0,
                400.0,
                if count > 1000 { "#963e2b" } else { MUTED },
            )
            .wrap()
            .w_full(),
        );
    let mut actions = responsive_row(narrow).child(
        Button::new("Enviar pergunta")
            .variant(ButtonVariant::Contrast)
            .disabled(disabled || count == 0 || count > 1000)
            .on_press(|s: &mut State| s.ask_chat())
            .build(k)
            .key("chat-send")
            .h(44.0),
    );
    if s.chat.busy {
        actions = actions.child(button(k, "chat-cancel", "Cancelar resposta", false, |_| {
            host(json!({"type":"chat_cancel"}))
        }));
    }
    actions = actions.child(
        Button::new("Nova conversa")
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
                    "Atualizando suas estratégias…"
                } else {
                    "Vamos consultar suas estratégias?"
                },
                "O motor recalcula os resultados com as prioridades e o cenário escolhidos.",
                narrow,
            ))
            .child(priorities_panel(s, k, narrow))
            .child(scenario_panel(s, k, narrow))
            .child(if s.loading {
                button(k, "cancel-priorities", "Cancelar análise", false, |s| {
                    s.page = Page::Setup;
                    host(json!({"type":"cancel"}));
                })
            } else {
                Button::new("Aplicar cenário")
                    .variant(ButtonVariant::Contrast)
                    .disabled(!s.ready || s.farm.is_none() || s.adjustment_blocked())
                    .on_press(State::analyze)
                    .build(k)
                    .key("apply-scenario")
                    .h(44.0)
            })
            .child(button(
                k,
                "back-setup",
                "← Editar fazenda e histórico",
                false,
                |s| s.page = Page::Setup,
            ));
    };
    let mut card_items = vec![current_rotation_card(
        &analysis.current_rotation,
        k,
        narrow,
        analysis.demo,
    )];
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
        4
    } else {
        2
    };
    let mut cards = col().gap(20.0).w_full();
    let mut line = responsive_row(narrow);
    let count = card_items.len();
    for (i, card) in card_items.into_iter().enumerate() {
        line = line.child(card);
        if (i + 1) % columns == 0 || i + 1 == count {
            cards = cards.child(line);
            line = responsive_row(narrow);
        }
    }
    let mut view = col().gap(24.0).w_full()
        .child(button(k, "back-setup", "← Editar fazenda e histórico", false, |s| s.page = Page::Setup))
        .child(heading(if analysis.recommendations.is_empty() { "Vamos ajustar o calendário?" } else { "As melhores pontuações de hoje." }, if analysis.recommendations.is_empty() { "O motor verificou as épocas de plantio. Confira os motivos abaixo e ajuste as opções para uma nova análise." } else { "Até três estratégias na ordem do motor, com as suas prioridades. Compare a posição e a pontuação de hoje e do futuro, junto da sua rotação atual." }, narrow))
        .child(farm_summary(s)).child(analysis_banner(analysis))
        .child(priorities_panel(s, k, narrow))
        .child(scenario_panel(s, k, narrow))
        .child(adjustment_banner(analysis))
        .child(paragraph(&analysis.priority_note))
        .child(paragraph(&analysis.scenario_note))
        .child(chat_panel(s, k, narrow))
        .child(cards);
    if analysis.recommendations.is_empty() {
        view = view.child(panel().child(label("Nenhuma sequência viável", 22.0, 600.0, INK).wrap())
            .child(paragraph("As épocas de plantio não couberam nas opções informadas. Revise o mês em que o talhão fica livre e a quantidade de culturas no planejamento.")));
    } else {
        view = view.child(label("A rotação atual é uma referência e pode coincidir com uma sugestão. Os cards seguem a pontuação de hoje; a posição no futuro pode mudar. A receita dos cards soma toda a sequência; a prioridade renda considera a receita por ano de ocupação. Receitas são brutas, sem custos. Os índices não representam probabilidades.", 11.0, 400.0, MUTED).wrap().w_full());
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
    col().w_full().gap(22.0).child(button(k, "back-results", "← Comparar estratégias", false, |s| s.page = Page::Results))
        .child(col().gap(10.0).child(pill(name, tint, accent)).child(label(&rec.crop, if narrow { 33.0 } else { 42.0 }, 600.0, INK).role("heading").level(1).wrap().w_full())
            .child(paragraph(format!("{tagline}. {}", rec.reason))))
        .child(farm_summary(s)).child(analysis_banner(analysis)).child(adjustment_banner(analysis)).child(paragraph(&analysis.scenario_note)).child(facts)
        .child(paragraph(&analysis.priority_note))
        .child(chat_panel(s, k, narrow))
        .child(benefits_panel(rec))
        .child(warnings_panel(rec, narrow))
        .child(col().gap(13.0).child(label("Seu ciclo, etapa por etapa", 22.0, 600.0, INK).wrap())
            .child(paragraph("Selecione uma cultura para ver os detalhes. Ano 1 é o ano inicial do planejamento; o calendário pode atravessar dezembro."))
            .child(el().w_full().scroll_x().child(months.min_w(rec.month_labels.len() as f32 * 83.0))))
        .child(exposure_panel(s, rec, narrow))
        .child(responsive_row(narrow).child(column_width(stages, narrow, 0.8)).child(column_width(detail, narrow, 1.2)))
        .child(panel().child(label("Água, mês a mês", 22.0, 600.0, INK))
            .child(paragraph(&rec.water_caption))
            .child(el().w_full().scroll_x().child(water_table)))
        .child(panel().gap(8.0).child(eyebrow("O QUE CONSIDERAR NESTA ESCOLHA")).child(paragraph(&rec.tradeoff)))
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
        .role("main")
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
