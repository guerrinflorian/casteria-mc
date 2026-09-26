// Le bloc a photographier vient de l'adresse (#banniere, #bouton-windows...).
document.body.dataset.bloc = (location.hash || '#banniere').slice(1);
