export const VALID_CATEGORIES = [
    "gastos fixos",
    "lazer",
    "investimento",
    "conhecimento",
    "doação",
  ];  

export const VALID_CATEGORIES_INCOME = [
  "Salário",
  "Renda extra"
]

// Audio Processing Constants
export const AUDIO_CONSTANTS = {
  // File size limits
  MAX_FILE_SIZE: 16 * 1024 * 1024, // 16MB (WhatsApp limit)
  MIN_FILE_SIZE: 1024, // 1KB minimum
  
  // Duration limits
  MAX_DURATION_SECONDS: 30, // WhatsApp voice message limit
  MIN_DURATION_SECONDS: 1,
  
  // Timeout configurations
  DEFAULT_PROCESSING_TIMEOUT: 30000, // 30 seconds total
  DEFAULT_DOWNLOAD_TIMEOUT: 15000, // 15 seconds for download
  DEFAULT_TRANSCRIPTION_TIMEOUT: 15000, // 15 seconds for transcription
  
  // Supported MIME types
  SUPPORTED_MIME_TYPES: [
    'audio/ogg; codecs=opus', // WhatsApp default
    'audio/ogg',
    'audio/mp3',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
    'audio/m4a',
    'audio/webm'
  ],
  
  // Supported file extensions
  SUPPORTED_EXTENSIONS: [
    '.ogg',
    '.mp3',
    '.wav',
    '.aac',
    '.m4a',
    '.webm'
  ],
  
  // Error types
  ERROR_TYPES: {
    DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    FILE_TOO_SMALL: 'FILE_TOO_SMALL',
    UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
    DURATION_TOO_LONG: 'DURATION_TOO_LONG',
    TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
    TRANSCRIPTION_EMPTY: 'TRANSCRIPTION_EMPTY',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    PROCESSING_TIMEOUT: 'PROCESSING_TIMEOUT',
    INVALID_MEDIA_ID: 'INVALID_MEDIA_ID',
    NETWORK_ERROR: 'NETWORK_ERROR'
  },
  
  // User-friendly error messages in Portuguese
  ERROR_MESSAGES: {
    DOWNLOAD_FAILED: "Não consegui baixar seu áudio. Tente enviar novamente.",
    FILE_TOO_LARGE: "Seu áudio é muito grande. Envie um áudio de até 16MB.",
    FILE_TOO_SMALL: "Arquivo de áudio muito pequeno ou corrompido.",
    UNSUPPORTED_FORMAT: "Formato de áudio não suportado. Use MP3, WAV, OGG ou AAC.",
    DURATION_TOO_LONG: "Seu áudio é muito longo. Envie um áudio de até 30 segundos.",
    TRANSCRIPTION_FAILED: "Não consegui entender seu áudio. Tente falar mais claramente ou envie uma mensagem de texto.",
    TRANSCRIPTION_EMPTY: "Seu áudio está muito baixo ou sem fala. Tente gravar novamente.",
    SERVICE_UNAVAILABLE: "Serviço de áudio temporariamente indisponível. Tente novamente em alguns minutos.",
    PROCESSING_TIMEOUT: "Processamento do áudio demorou muito. Tente com um áudio mais curto.",
    INVALID_MEDIA_ID: "ID de mídia inválido. Tente enviar o áudio novamente.",
    NETWORK_ERROR: "Erro de conexão. Verifique sua internet e tente novamente."
  },
  
  // Processing status
  PROCESSING_STATUS: {
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    TRANSCRIBING: 'transcribing',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  },
  
  // Retry configuration
  RETRY_CONFIG: {
    MAX_DOWNLOAD_RETRIES: 3,
    MAX_TRANSCRIPTION_RETRIES: 2,
    BASE_DELAY_MS: 1000,
    MAX_DELAY_MS: 10000,
    BACKOFF_MULTIPLIER: 2
  }
};