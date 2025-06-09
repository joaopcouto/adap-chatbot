import sys #para interagir com o terminal
import json #para interagir com arquivos json
import matplotlib.pyplot as plt #para crição de gráficos
import os #para interagir com o sistema, exemplo: abrir arquivos
import cloudinary #para interagir com a plataforma
import cloudinary.uploader #módulo para uploads

script_dir = os.path.dirname(os.path.abspath(__file__)) #diretorio raiz do script
os.chdir(script_dir) #diretorio atual vira o do script

#função para garantir que temos o caminho absoluto de um arquivo
def get_absolute_path(relative_path): 
    return os.path.abspath(relative_path)

# Verifica se o script recebeu a quantidade certa de argumentos
if len(sys.argv) < 3:
    print("Erro: Argumentos insuficientes! Use: python generate_category_chart.py input.json output.png")
    sys.exit(1) #encerra o script2

json_file_path = get_absolute_path(sys.argv[1]) #caminho absoluto do json entrada
output_image_path = get_absolute_path(sys.argv[2]) #caminho absoluto do json saída

# Verifica se o arquivo JSON existe
if not os.path.exists(json_file_path):
    print(f"Erro: Arquivo JSON não encontrado: {json_file_path}")
    sys.exit(1)

# Carregar dados do JSON
try:
    with open(json_file_path, "r", encoding="utf-8") as file: #abre o json no modo leitura
        data = json.load(file) #converte o conteúdo json em uma lista de dicionários python
except json.JSONDecodeError as e: #identifica se o json não é válido
    print(f"Erro: JSON inválido! {e}")
    sys.exit(1)
except Exception as e: #identifica qualquer erro e cancela a leitura
    print(f"Erro ao ler o arquivo JSON: {e}", file=sys.stderr)
    sys.exit(1)    

if not data: #identifica um json vazio
    print("Erro: Nenhum dado encontrado no JSON!")
    sys.exit(1)

#tratando os dados para o gráfico 
categories = [] #categorias
amounts = [] #valores

if data: # mais uma garantia de que os dados não estão vazios
    categories = [item["_id"] for item in data] #extrai as chaves do json convertido
    raw_amounts = [item["total"] for item in data] #extrai valores do json convertido

    for i, raw_amount in enumerate(raw_amounts):
        try:
            amount = float(raw_amount) #padronizando todos valores para float
            if amount < 0:
                print(f"Aviso: Valor negativo R${amount} para categoria '{categories[i]}' será tratado como R$0.", file=sys.stderr)
                amounts.append(0.0) 
                #valores negativos estao sendo tratados como zero
                #utilizar valores negativos como saldo devedor pode ser implementado em casos de parcelas de crédito
            else:
                amounts.append(amount) #adiciona os valores positivos (caso ideal)
        except (ValueError, TypeError) as e:
            print(f"Erro: Valor '{raw_amount}' para categoria '{categories[i]}' não é um número válido. Detalhes: {e}", file=sys.stderr)
            sys.exit(1) # Falha crítica se um valor não puder ser convertido


# selecionando paleta de cores com tons de verde
num_categories = len(categories) #numero de categorias atual
colors_to_use = [] #numero de cores para usar na paleta

if num_categories > 0: #valida se existe ao menos 1 categoria
    verde_claro = "#F3E5AB"    
    verde_medio = "#E6D27A"    
    verde_escuro = "#C8B458"   
    
    #alternativa com menos saturação:
    #verde_claro = "#C8E6C9" 
    #verde_medio = "#81C784"   
    #verde_escuro = "#4CAF50"

    if num_categories == 1: #se houver uma categoria, usar medio
        colors_to_use = [verde_medio]
    elif num_categories % 2 != 0:  #se é ímpar, usar os três tons
        three_shades = [verde_claro, verde_medio, verde_escuro]
        for i in range(num_categories):
            colors_to_use.append(three_shades[i % 3]) #adiciona uma cor de cada vez até atingir o numero de categorias
    else:  # se é par, usar dois tons extremos
        two_shades = [verde_claro, verde_escuro] # também adiciona uma cor de cada vez até atingir o numero de categorias
        for i in range(num_categories):
            colors_to_use.append(two_shades[i % 2])

#formatar valores exibidos no gráfico pizza
def format_value_for_pie(pct, all_values): #recebe a porcentagem da categoria e uma lista com todos os valores
    if not all_values or sum(all_values) == 0: #descarta valores nulos
        return ''
    absolute = pct/100.*sum(all_values)
    return f"R$ {absolute:,.1f}\n({pct:.1f}%)" # zero casas decimais para não poluir

#criar gráfico de pizza
if data: #mais uma vez, validando dados
    fig, ax = plt.subplots(figsize=(12, 7.5)) #configurações de plot

    # Se não houver valores positivos para plotar após o processamento, imprime uma imagem no grafico
    if not amounts or all(a <= 0 for a in amounts):
        ax.text(0.5, 0.5, "Não há gastos positivos para exibir.",
                horizontalalignment='center', verticalalignment='center',
                fontsize=12, transform=ax.transAxes, wrap=True)
        ax.axis('off') # Esconde os eixos
    else:
        wedges, texts, autotexts = ax.pie(
            amounts, #valores de cada fatia
            autopct=lambda pct: format_value_for_pie(pct, amounts), #funcao lambda para formatação rapida
            startangle=90, # Começa no topo
            colors=colors_to_use,
            pctdistance=1.15, # Distância do texto do centro (maior de 1 é fora do grafico)
            wedgeprops=dict(edgecolor='white', linewidth=1.5) # Borda branca entre fatias
        )

        # texto dentro das fatias
        for autotext_obj in autotexts:
            autotext_obj.set_fontsize(8.5) # Tamanho menor para caber valores
            autotext_obj.set_weight("bold") # negrito
            autotext_obj.set_color("black") # Cor do texto

        # adiciona legenda
        legend_labels = [f"{cat} (R$ {amt:,.2f})" for cat, amt in zip(categories, amounts)]

        ax.legend(
            wedges, # Os objetos 'wedge' para que o matplotlib associe as cores
            legend_labels,
            title="Categorias de Gastos",
            loc="center left",
            bbox_to_anchor=(1.02, 0.5), # (x, y) da âncora da legenda, fora do eixo principal
            fontsize=9.5,
            title_fontsize=11
        )
    ax.set_title("Distribuição de Gastos por Categoria", fontsize=15, fontweight="bold", pad=25)
    # Ajustar layout para garantir que a legenda não seja cortada
    # rect = [left, bottom, right, top] em coordenadas da figura (0 a 1)
    plt.tight_layout(rect=[0, 0, 0.82, 1])
    
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
