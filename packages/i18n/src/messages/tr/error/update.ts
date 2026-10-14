import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Kullanıcının okuduğu güncelleyici durumu.
  "error.update.unsupported": "Güncellemeler yüklü masaüstü derlemelerinde kullanılabilir.",
  "error.update.notReady": "Bir güncelleme yüklenmeye hazır değil.",
  "error.update.restartFailed": "AIKINGBOT güncellemeyi yüklemek için yeniden başlatılamadı.",
  "error.update.downloadStalled": "Güncelleme indirmesi yanıt vermeyi durdurdu. Tekrar deneyin.",
  "error.update.installFailed": "Güncelleme yüklenemedi. AIKINGBOT'tan çıkıp yeniden açın, ardından tekrar deneyin.",
  "error.update.downloadFailed": "Güncelleme indirilemedi. Tekrar deneyin.",
  "error.update.checkFailed": "Güncellemeler kontrol edilemedi. Tekrar deneyin.",
  "error.update.checkStalled": "Güncelleme kontrolü yanıt vermeyi durdurdu. Tekrar deneyin.",
  "error.update.checkOffline":
    "Güncelleme servisine ulaşılamadı. İnternet bağlantınızı kontrol edin, ardından tekrar deneyin.",
  "error.update.checkUnavailable":
    "Güncelleme servisi yanıt vermedi. AIKINGBOT birkaç dakika içinde kendiliğinden tekrar dener.",
  "error.update.checkNoRelease":
    "Bu platform için yayınlanmış bir güncelleme bulunamadı. AIKINGBOT birkaç dakika içinde kendiliğinden tekrar dener.",
  "error.update.managedByHost":
    "Bu Mac üzerindeki güncellemeler ana makine tarafından yüklenir. Güncelleme, ana makinenin bakımı çalışana kadar hazır kalır.",
  "error.update.siblingSession":
    "Bu uygulamadan çalışan başka bir AIKINGBOT oturumu var. Önce diğer tüm macOS kullanıcı hesaplarında AIKINGBOT'u durdurun, ardından güncellemeyi tekrar yükleyin.",
  "error.update.siblingSessionSameAccount":
    "Bu kullanıcı hesabında başka bir AIKINGBOT işlemi hâlâ çalışıyor. Ondan çıkın, ardından güncellemeyi tekrar yükleyin.",
  "error.update.siblingCheckFailed": "Diğer AIKINGBOT oturumları doğrulanamadı. Yüklemeden önce tekrar deneyin.",
  // Katılınan bir sunucunun yöneticisi bunları ana makineden okur.
  "error.update.remoteDisabled": "Sunucu yöneticilerinden gelen güncellemeler bu bilgisayarda kapalı.",
  "error.update.restartStarted": "AIKINGBOT, güncellemeyi yüklemek için zaten yeniden başlatılıyor.",
  "error.update.alreadyRestarting": "AIKINGBOT zaten yeniden başlatılıyor.",
} as const satisfies PartialTranslation<typeof source>;
