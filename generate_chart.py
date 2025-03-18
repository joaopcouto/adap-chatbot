import sys
import json
import matplotlib.pyplot as plt
import datetime
import os
import numpy as np

#  Garantir que o script está rodando no diretório correto
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

#  Função para obter caminho absoluto
def get_absolute_path(relative_path):
    return os.path.abspath(relative_path)

#  Verificar argumentos
if len(sys.argv) < 3:
    print(" Erro: Argumentos insuficientes! Use: python generate_chart.py input.json output.png")
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

#  Verifica se o arquivo JSON existe
if not os.path.exists(json_file_path):
    print(f" Erro: Arquivo JSON não encontrado: {json_file_path}")
    sys.exit(1)

#  Carregar dados do JSON
try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
    print(f" JSON carregado com sucesso: {data}")
except json.JSONDecodeError as e:
    print(f" Erro: JSON inválido! {e}")
    sys.exit(1)

#  Verifica se o JSON está vazio
if not data:
    print(" Erro: Nenhum dado encontrado no JSON!")
    sys.exit(1)

#  Traduzir os dias da semana para português
dias_semana = {
    "Mon": "seg", "Tue": "ter", "Wed": "qua", "Thu": "qui",
    "Fri": "sex", "Sat": "sáb", "Sun": "dom"
}

#  Processa os dados
try:
    dates = [datetime.datetime.strptime(item["_id"], "%Y-%m-%d") for item in data]
    totals = [item["total"] for item in data]
    weekdays = [dias_semana[d.strftime("%a")] for d in dates]
    formatted_dates = [f"{dias_semana[d.strftime('%a')]} ({d.strftime('%d/%m')})" for d in dates]

except Exception as e:
    print(f" Erro ao processar os dados: {e}")
    sys.exit(1)

# Garantir que todos os 7 dias da semana sejam exibidos, mesmo que sem valores
dias_da_semana_ordenados = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
totals_por_dia = {dia: 0 for dia in dias_da_semana_ordenados}  # Iniciar com zero
formatted_labels = {dia: "" for dia in dias_da_semana_ordenados}  # Para armazenar os rótulos formatados

# Atualizar os valores reais dos dias que têm gastos registrados
for d, dia, total in zip(dates, weekdays, totals):
    totals_por_dia[dia] = total
    formatted_labels[dia] = f"{dia} ({d.strftime('%d/%m')})"

# Criar listas ordenadas para exibição no gráfico
dias_plot = [formatted_labels[dia] if formatted_labels[dia] else dia for dia in dias_da_semana_ordenados]
totais_plot = list(totals_por_dia.values())

#  Calcular o total de gastos nos dias exibidos
total_gastos = sum(totais_plot)

#  Criar o gráfico
fig, ax = plt.subplots(figsize=(14, 6))  # Ajuste do tamanho da figura
bars = ax.bar(dias_plot, totais_plot, color="#064e3b", alpha=0.8, width=0.6)  # Ajustar a largura das barras

#  Adicionar rótulos de valores nas barras
for bar, total in zip(bars, totais_plot):
    ax.text(
        bar.get_x() + bar.get_width() / 2,  # Posição X centralizada
        bar.get_height() + max(totais_plot) * 0.02,  # Posição Y ajustada acima da barra
        f"R$ {total:.2f}",  # Texto formatado
        ha="center", va="bottom", fontsize=10, fontweight="bold", color="#064e3b"
    )

#  Estilizar o gráfico
ax.set_xlabel("")
ax.set_ylabel("")
ax.set_title("Gastos nos últimos dias", fontsize=14, fontweight="bold", loc="center", color="#064e3b")

#  Adicionar o total gasto abaixo do título
ax.text(
    0.5,  # Posição X relativa (meio do gráfico)
    1.05,  # Posição Y relativa (logo abaixo do título)
    f"Total: R$ {total_gastos:.2f}",  # Texto com o valor total
    fontsize=12, fontweight="bold", color="#064e3b", ha="center", transform=ax.transAxes
)

# Remover bordas desnecessárias
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_visible(False)
ax.spines["bottom"].set_color("#064e3b")

# Garantir que todos os dias da semana apareçam no eixo X corretamente
ax.set_xticks(np.arange(len(dias_plot)))
ax.set_xticklabels(dias_plot, rotation=0, fontsize=12, color="#064e3b", ha="center")

# Remover valores do eixo Y para foco apenas nas barras
plt.yticks([])

# Ajustar layout para evitar cortes
plt.tight_layout()

#  Salvar o gráfico
try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
    print(f" Imagem salva com sucesso: {output_image_path}")
except Exception as e:
    print(f" Erro ao salvar a imagem: {e}")
    sys.exit(1)
