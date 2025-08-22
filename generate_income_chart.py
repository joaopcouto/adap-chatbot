import sys
import json
import matplotlib.pyplot as plt
import os
import cloudinary
import cloudinary.uploader
import string

script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

def get_absolute_path(relative_path): 
    return os.path.abspath(relative_path)

if len(sys.argv) < 3:
    print("Erro: Use: python generate_income_chart.py input.json output.png")
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
except Exception as e:
    print(f"Erro ao ler o arquivo JSON: {e}", file=sys.stderr)
    sys.exit(1)    

if not data:
    print("Erro: Nenhum dado de receita encontrado no JSON!")
    sys.exit(1)

categories = [string.capwords(item["_id"]) for item in data]
amounts = [item["total"] for item in data]

num_categories = len(categories)
colors_to_use = []
if num_categories > 0:
    verde_claro = "#D4EDDA"    
    verde_medio = "#A3D9B1"    
    verde_escuro = "#73C686"
    
    shades = [verde_claro, verde_medio, verde_escuro]
    for i in range(num_categories):
        colors_to_use.append(shades[i % 3])

def format_value_for_pie(pct, all_values):
    if not all_values or sum(all_values) == 0:
        return ''
    return f'({pct:.0f}%)'

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 12), gridspec_kw={'height_ratios': [3, 1]})

wedges, texts, autotexts = ax1.pie(
    amounts,
    autopct=lambda pct: format_value_for_pie(pct, amounts),
    startangle=90,
    colors=colors_to_use,
    pctdistance=1.05,
    wedgeprops=dict(edgecolor='black', linewidth=1)
)

for i, autotext_obj in enumerate(autotexts):
    letter = string.ascii_uppercase[i % 26]
    autotext_obj.set_text(letter)
    autotext_obj.set_fontsize(8.5)
    autotext_obj.set_weight("bold")
    autotext_obj.set_color("black")

ax1.set_title("Distribuição de Receitas por Categoria", fontsize=15, fontweight="bold", pad=25)
legend_labels = [f"{string.ascii_uppercase[i % 26]}: {cat} - R$ {amt:,.2f} {format_value_for_pie(amounts[i] / sum(amounts) * 100, amounts)}" for i, (cat, amt) in enumerate(zip(categories, amounts))]
ax2.axis('off')
ax2.legend(wedges, legend_labels, title="Fontes de Receita", loc="center", fontsize=9.5, title_fontsize=11)

try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
except Exception as e:
    print(f"Erro ao salvar a imagem: {e}")
    sys.exit(1)

cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET")
)

try:
    result = cloudinary.uploader.upload(output_image_path, folder="whatsapp_reports")
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