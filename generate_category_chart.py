import sys
import json
import matplotlib.pyplot as plt
import os

#  Garantir que o script está rodando no diretório correto
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

#  Função para obter caminho absoluto
def get_absolute_path(relative_path):
    return os.path.abspath(relative_path)

#  Verificar argumentos
if len(sys.argv) < 3:
    print("Erro: Argumentos insuficientes! Use: python generate_category_chart.py input.json output.png")
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

#  Verifica se o arquivo JSON existe
if not os.path.exists(json_file_path):
    print(f"Erro: Arquivo JSON não encontrado: {json_file_path}")
    sys.exit(1)

#  Carregar dados do JSON
try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
    print(f" JSON carregado com sucesso: {data}")
except json.JSONDecodeError as e:
    print(f"Erro: JSON inválido! {e}")
    sys.exit(1)

#  Verifica se o JSON está vazio
if not data:
    print("Erro: Nenhum dado encontrado no JSON!")
    sys.exit(1)

#  Processar dados
categories = [item["_id"] for item in data]
amounts = [item["total"] for item in data]

#  Definir cores para cada categoria
colors = ["#ff9999", "#66b3ff", "#99ff99", "#ffcc99", "#c2c2f0", "#ffb3e6"]

#  Criar o gráfico de pizza
fig, ax = plt.subplots(figsize=(8, 8))
wedges, texts, autotexts = ax.pie(
    amounts, labels=categories, autopct="%1.1f%%", startangle=140, colors=colors
)

#  Estilizar rótulos
for text, autotext in zip(texts, autotexts):
    text.set_fontsize(12)
    autotext.set_fontsize(12)
    autotext.set_weight("bold")

ax.set_title("Distribuição de Gastos por Categoria", fontsize=14, fontweight="bold")

#  Salvar a imagem
try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
    print(f" Imagem salva com sucesso: {output_image_path}")
except Exception as e:
    print(f"Erro ao salvar a imagem: {e}")
    sys.exit(1)
