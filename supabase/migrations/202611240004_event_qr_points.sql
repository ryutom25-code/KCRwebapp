-- Use 50 points for event QR codes that have already been issued.
update public.qr_codes
set points = 50
where category = 'event' and points is distinct from 50;
