import sys
import json
import matplotlib.pyplot as plt
import os
import cloudinary
import cloudinary.uploader

# Garantir que o script está rodando no diretório correto
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

def get_absolute_path(relative_path):
    return os.path.abspath(relative_path)

# Verificar argumentos
if len(sys.argv) < 3:
    print("Erro: Argumentos insuficientes! Use: python generate_category_chart.py input.json output.png")
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

# Verifica se o arquivo JSON existe
if not os.path.exists(json_file_path):
    print(f"Erro: Arquivo JSON não encontrado: {json_file_path}")
    sys.exit(1)

# Carregar dados do JSON
try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
except json.JSONDecodeError as e:
    print(f"Erro: JSON inválido! {e}")
    sys.exit(1)

if not data:
    print("Erro: Nenhum dado encontrado no JSON!")
    sys.exit(1)

# Processar dados
categories = [item["_id"] for item in data]
amounts = [item["total"] for item in data]

# Definir cores para cada categoria (limitado a 6, mas pode expandir)
colors = ["#ff9999", "#66b3ff", "#99ff99", "#ffcc99", "#c2c2f0", "#ffb3e6"]

# Criar gráfico de pizza
fig, ax = plt.subplots(figsize=(8, 8))
wedges, texts, autotexts = ax.pie(
    amounts, labels=categories, autopct="%1.1f%%", startangle=140, colors=colors
)

for text, autotext in zip(texts, autotexts):
    text.set_fontsize(12)
    autotext.set_fontsize(12)
    autotext.set_weight("bold")

ax.set_title("Distribuição de Gastos por Categoria", fontsize=14, fontweight="bold")

plt.tight_layout()

# Salvar a imagem
try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
except Exception as e:
    print(f"Erro ao salvar a imagem: {e}")
    sys.exit(1)

# Upload para Cloudinary
cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET")
)

try:
    result = cloudinary.uploader.upload(
    output_image_path,
    folder="whatsapp_reports",
    resource_type="image",
    type="upload",  # garante que seja uma URL direta pública
    use_filename=True,
    unique_filename=False
)
    image_url = result.get("secure_url")
    if image_url:
        print(image_url)
        sys.exit(0)
    else:
        print("Erro: URL não retornada.")
        sys.exit(1)
except Exception as e:
    print(f"Erro ao enviar para Cloudinary: {e}")
    sys.exit(1)
