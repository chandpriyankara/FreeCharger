#pm2 start run.sh 
#pm2 delete 0
#pm2 save
#pm2 list
#pm2 startup
#nohup ssh -N 127.0.0.1 -L :8080:127.0.0.1:8081 &
#node /home/evpoint/evpoint-socket/index.js
node /home/evpoint/evpoint-socket/SOAP/index.js
#/home/evpoint/evpoint-socket/forward.sh 


