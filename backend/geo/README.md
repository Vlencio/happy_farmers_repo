# Limite de Minas Gerais

`minas_gerais.geojson` é a resposta original da API de malhas simplificadas do
IBGE, UF 31, qualidade máxima, obtida em 14/11/2026:

https://servicodados.ibge.gov.br/api/v3/malhas/estados/31?formato=application/vnd.geo+json&qualidade=maxima

Documentação: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3

O arquivo é versionado e incluído no pacote da API: nenhuma chamada ao IBGE ocorre
durante a análise. O teste usa o ponto enviado pela tela (centro da caixa do talhão),
não o contorno inteiro. É uma malha simplificada, adequada ao aviso de escopo da
aplicação, não à verificação cadastral de divisas. Fora de Minas, mas dentro da grade
regional, a análise continua com aviso; fora da grade, retorna HTTP 422.
