// Fixed UX fixture. Nothing here scores, predicts or consults NASA datasets.
// The agronomic engine belongs to the Python/FastAPI service.
const stage = (id, title, period, start, end, description, water, soil, risk) => ({
  id, title, period, start_month: start, end_month: end, description, water, soil, risk,
});
export function demoAnalysis() {
  return {
    schema_version: '1.0', analysis_id: 'demo-ui-v1', demo: true,
    summary: 'Três caminhos para explorar a experiência. Culturas, valores e períodos são exemplos fixos e não foram calculados para sua fazenda.',
    recommendations: [
      {
        category: 'income', crop: 'Soja → milho', metric: 'R$ 8.450/ha', metric_label: 'Receita bruta ilustrativa / ciclo',
        reason: 'Um exemplo de sucessão de duas culturas comerciais, priorizando a receita potencial do ciclo.',
        tradeoff: 'A segunda cultura exige atenção à janela de plantio. Receita bruta não desconta custos e não equivale a lucro.',
        facts: [{ label: 'Foco', value: 'Receita bruta' }, { label: 'Sequência', value: '2 culturas comerciais' }, { label: 'Confiança', value: 'Não calculada • demonstração' }],
        timeline: [
          stage('prepare', 'Preparar o ciclo', 'Mês 1', 1, 1, 'Conferir o histórico do talhão e planejar a sequência escolhida. Na integração real, o motor indicará as janelas adequadas.', 'Aguardar avaliação da disponibilidade hídrica.', 'Conferir análise de solo e cobertura existente.', 'Calendário demonstrativo, sem recomendação de data.'),
          stage('soy', 'Soja', 'Meses 2–5', 2, 5, 'Acompanhar o estabelecimento, desenvolvimento e colheita da primeira cultura comercial.', 'O motor poderá sinalizar períodos de maior demanda.', 'Registrar manejo e condições do solo.', 'Preço, produtividade e clima ainda não avaliados.'),
          stage('corn', 'Milho', 'Meses 6–9', 6, 9, 'Visualizar a segunda cultura no mesmo ciclo e as condições necessárias para sua implantação.', 'Verificar a chuva prevista para a segunda janela.', 'Monitorar a cobertura deixada pela cultura anterior.', 'A janela da segunda safra pode ser limitante.'),
          stage('review', 'Cobertura e revisão', 'Meses 10–12', 10, 12, 'Registrar o resultado do ciclo e usar esse histórico na próxima análise.', 'Acompanhar o balanço hídrico do período.', 'Avaliar cobertura e resíduos no solo.', 'Confirmar decisões com a equipe técnica.'),
        ],
      },
      {
        category: 'soil', crop: 'Milheto → soja', metric: 'Solo protegido', metric_label: 'Benefício ilustrativo de cobertura',
        reason: 'Um exemplo que dá espaço a uma cultura de cobertura antes da cultura comercial.',
        tradeoff: 'O período destinado à cobertura reduz o espaço para outra cultura comercial. O benefício real depende do manejo e da análise local.',
        facts: [{ label: 'Foco', value: 'Cobertura do solo' }, { label: 'Sequência', value: 'Cobertura + cultura comercial' }, { label: 'Saúde do solo', value: 'Índice ainda não calculado' }],
        timeline: [
          stage('diagnosis', 'Conhecer o solo', 'Mês 1', 1, 1, 'Reunir o histórico e as observações do talhão para dar contexto à avaliação.', 'Avaliar disponibilidade para a implantação.', 'Conferir análise de solo e áreas descobertas.', 'O protótipo não diagnostica o solo.'),
          stage('cover', 'Milheto de cobertura', 'Meses 2–4', 2, 4, 'Representação de uma fase dedicada à cobertura antes da cultura comercial.', 'Demanda hídrica a ser informada pelo motor.', 'Observar estabelecimento e produção de cobertura.', 'Manejo e término da cobertura precisam de avaliação local.'),
          stage('soy', 'Soja', 'Meses 5–9', 5, 9, 'Planejar a cultura comercial após a cobertura e acompanhar seu desenvolvimento.', 'Conferir a janela de chuva adequada à região.', 'Registrar como a cobertura se mantém no período.', 'Calendário relativo, sem indicação de plantio.'),
          stage('monitor', 'Avaliar e registrar', 'Meses 10–12', 10, 12, 'Comparar o que foi observado no solo e preparar o próximo ciclo.', 'Atualizar observações de água no talhão.', 'Registrar cobertura e avaliação técnica.', 'Os benefícios apresentados são apenas ilustrativos.'),
        ],
      },
      {
        category: 'climate', crop: 'Sorgo → cobertura', metric: 'Adaptação climática', metric_label: 'Alternativa ilustrativa de resiliência',
        reason: 'Um exemplo para explorar o caminho de maior adaptação às condições climáticas.',
        tradeoff: 'Resiliência não significa ausência de perdas. A escolha real depende do clima local, da cultivar, do solo e do mercado.',
        facts: [{ label: 'Foco', value: 'Adaptação ao clima' }, { label: 'Horizonte', value: '12 meses relativos' }, { label: 'Risco climático', value: 'Ainda não calculado' }],
        timeline: [
          stage('weather', 'Conferir o cenário', 'Mês 1', 1, 1, 'A futura análise combinará os cenários disponíveis e o contexto da fazenda.', 'Disponibilidade hídrica a ser analisada.', 'Avaliar as condições de implantação.', 'Nenhuma projeção climática é calculada nesta demo.'),
          stage('sorghum', 'Sorgo', 'Meses 2–6', 2, 6, 'Exemplo de cultura para comparar o caminho de adaptação climática.', 'Acompanhar os períodos críticos apontados pelo motor.', 'Monitorar cobertura e manejo.', 'Tolerância varia por cultivar e condições locais.'),
          stage('cover', 'Cobertura do talhão', 'Meses 7–10', 7, 10, 'Visualizar a continuidade do uso do solo após a colheita.', 'Rever a disponibilidade antes da implantação.', 'Manter observações da proteção do solo.', 'A espécie de cobertura ainda depende da análise.'),
          stage('review', 'Rever o próximo ciclo', 'Meses 11–12', 11, 12, 'Atualizar o histórico e avaliar o ciclo seguinte com novos dados.', 'Reavaliar o cenário de água.', 'Conferir registros e análise de solo.', 'Confirmar a escolha com orientação técnica.'),
        ],
      },
    ],
  };
}
