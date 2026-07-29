# AKIM ERP

Bu klasor, Excel tabanli finans/maliyet/personel takip workbook'unu muhasebecinin gunluk is akisiyle kullanabilecegi operasyonel ERP urun iskeletine donusturmek icin hazirlanmistir.

## Kapsam

- Muhasebe paneli ve is kuyruklari
- Alis faturasi list report ve fatura denetci paneli
- Cari borc ve acik bakiye gorunumu
- Banka mutabakati ekrani
- Odeme plani ve cek/senet portfoyu
- Personel kıdem, maaş, avans ve ödenecek maaş listesi
- KDV / tevkifat donem raporu
- Veri kalite ve kapanis kontrolleri
- Hızlı veri girisi icin `Import Center`
- SQLite tabanli yerel veri tabani
- KVKK icin T.C. kimlik, IBAN ve telefon maskeleme

## Calistirma

```powershell
cd "C:\Users\Gaming\Documents\Projeler\erp"
& "C:\Users\Gaming\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\server.py
```

Sonra tarayicida:

```text
http://127.0.0.1:8088
```

## Login / Register

- Ilk kayit olan kullanici `admin` roluyle olusur.
- Sonraki kayitlar icin production'da `ERP_INVITE_CODE` ayarlanmalidir.
- `ERP_ALLOW_OPEN_REGISTRATION=false` tutulmalidir.
- Parolalar PBKDF2-SHA256 ile salt'li ve 600.000 iterasyonla saklanir.
- Oturumlar HttpOnly cookie ile yonetilir.

## Excel Import

`Import Center` sekmesinden `.xlsx` dosyasi yuklenebilir. Asagidaki sayfalar otomatik eslenir:

- `Banka_Ekstresi` -> `bank_statement_lines`
- `Gunluk_Fatura_Hareketleri` -> `purchase_invoices`
- `Personel` -> `employees`
- `Cek_Senet_Takibi` -> `payment_instruments`
- `Tanimlar` -> `reference_values`

Import calismadan once mevcut SQLite veritabani `data/backups` altina timestamp'li olarak kopyalanir. Personel kartlarinda ERP icinden girilen maas, avans ve santiye bilgileri ayni personel tekrar import edilse bile korunur.

## Sonraki Gelistirme

1. Kullanici girisi, rol bazli yetki ve audit goruntuleme
2. Fatura olusturma/duzenleme ve onay akisi
3. Banka hareketi ile fatura/personel odemesi eslestirme motoru
4. Hesap plani, defteri kebir ve muhasebe fisi
5. Maliyet merkezi, proje boyutu ve zorunlu muhasebe boyutlari
6. Bordro entegrasyonu, maaş ödeme run'ı ve avans mahsuplaştırma
7. E-fatura/e-arsiv XML/PDF dokuman arsivi
8. Stok, satin alma talebi, siparis ve teslim alma

## Coolify Deploy

Bu proje Coolify uzerinde Docker Compose ile deploy edilecek sekilde hazirlandi.

1. Projeyi Git repository'ye push et.
2. Coolify'da yeni resource olarak Docker Compose tabanli application/service olustur.
3. `docker-compose.yml` dosyasini kaynak olarak kullan.
4. Domain ata ve HTTPS'i etkinlestir.
5. Environment Variables alaninda su degerleri gir:

```text
ERP_PORT=8088
ERP_COOKIE_SECURE=true
ERP_SESSION_DAYS=7
ERP_INVITE_CODE=uzun-rastgele-bir-davet-kodu
ERP_ALLOW_OPEN_REGISTRATION=false
ERP_MAX_UPLOAD_BYTES=10485760
```

6. Persistent storage/volume olarak `/app/data` dizinini kalici hale getir. SQLite veritabani ve yuklenen Excel dosyalari burada saklanir.
7. Ilk deploy sonrasi ilk kullaniciyi register ekranindan olustur. Bu kullanici admin olur.
8. Muhasebeci kullanicilar icin davet koduyla hesap olustur veya daha sonra admin paneli eklendiginde kullanicilari admin olustursun.

Veri kaybi olmamasi icin Coolify resource update/redeploy sirasinda `/app/data` volume'u silinmemelidir. Resource tamamen silinirse volume'un da silinip silinmedigini Coolify ekraninda ayrica kontrol et. Production pilotta `data/backups` klasorunun periyodik olarak sunucu disina yedeklenmesi onerilir.

## UI Kararlari

Arayuz, tanitim sayfasi gibi degil, ERP operasyon ekrani gibi tasarlanmistir:

- Sabit sol modul navigasyonu
- Ust sirket/donem/search/action bar
- KPI strip
- List report tablolar
- Sag detay/inspector paneli
- Veri kalite kontrolleri
- Import staging ve dogrulama ozeti
