step-1 sabse pahle hum ek private key kharidte hai go daddy se
step-2 is static ip par ek DNS register karte hai. 
step-3 iske bad hum apne dns ke liye go daddy se hi ssl cerificate karate hai https ke liye. so jab hum ye karte hai to hume ssl certificate milta hai. yaha se actually hume BalichaPlaza.pfx file milta hai.
       so is .pfx file se bhi hum sari chize nikal sakte hai jaise certificate.crt, certificate.pem, private.key.pem, public.txt file ye sari files. 

Note- lekin yaha hum ek galti kar baithte hai wo ye hai ki hum bank walo ko godaddy ne jo generate kiya hai humare website ke liye hum uska use karke bank ki api's ke sath integrate karte hai
so hume iske liye apne server ki machine par hi self signed generate karni hoti hai openssl se bank ki api se integrate karne ke liye.

in files ko generate karne ke liye kuch commands hai. aur wo commands ye hai

Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

PS C:\Users\Administrator> $OPENSSL = "C:\Users\Administrator\Downloads\openssl-3.6.1-oqs_provider-0.11.0\bin\openssl.exe"
PS C:\Users\Administrator> & $OPENSSL genrsa -out "D:\npci_keys\private.key.pem" 2048
PS C:\Users\Administrator> & $OPENSSL rsa -in "D:\npci_keys\private.key.pem" -pubout -out "D:\npci_keys\public.txt"
writing RSA key
PS C:\Users\Administrator> @"
>> [req]
>> default_bits = 2048
>> prompt = no
>> default_md = sha256
>> distinguished_name = dn
>> x509_extensions = v3_req
>>
>> [dn]
>> C = IN
>> ST = Rajasthan
>> L = Rajsamand
>> O = Houston System Pvt. Ltd.
>> OU = Toll Plaza IT
>> CN = balichatollplaza.co.in
>> emailAddress = singhkalika054@gmail.com
>>
>> [v3_req]
>> basicConstraints = critical,CA:FALSE
>> keyUsage = critical,digitalSignature,keyEncipherment
>> subjectKeyIdentifier = hash
>> authorityKeyIdentifier = keyid,issuer
>> "@ | Set-Content -Encoding ascii "D:\npci_keys\npci_cert.cnf"
PS C:\Users\Administrator> & $OPENSSL req -new -x509 -key "D:\npci_keys\private.key.pem" -out "D:\npci_keys\certificate.pem" -days 365 -config "D:\npci_keys\npci_cert.cnf"
PS C:\Users\Administrator> Copy-Item "D:\npci_keys\certificate.pem" "D:\npci_keys\certificate.crt"
PS C:\Users\Administrator>


so isse sari files locally hi generate ho jati hai bina kisi godaddy and all. 

ab hum bank walo ko apni public.txt files send karte hai. kyuki wo is public.txt se decrypt karte hai jo hum apne system se private.key.pem se encrypt karke bhejte hai to



