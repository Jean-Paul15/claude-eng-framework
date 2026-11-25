/* Accueil multi-projets : une carte par projet ; la liste se rafraîchit toute seule (sondage léger toutes les quatre secondes). */
function renderProjects(rows) {
  $('#sub').textContent = rows.length + ' projet' + (rows.length > 1 ? 's' : '') + ' suivi' + (rows.length > 1 ? 's' : '');
  $('#projects').innerHTML = rows.map(function (r) {
    var p = pct(r.done, r.total);
    return '<a class="card proj" href="p/' + r.index + '/"><h3>' + esc(r.name) + '</h3><div class="sub">' + (r.last ? 'Dernière action ' + ago(r.last) : 'Aucune action enregistrée') + '</div>'
      + '<div class="pr"><i style="width:' + p + '%"></i></div><div class="m"><span><b>' + p + ' %</b> terminé (' + r.done + '/' + r.total + ')</span><span>' + r.inProgress + ' en cours</span><span>' + r.blocked + ' bloquées</span>'
      + (r.waiting ? '<span class="down"><b>' + r.waiting + '</b> à décider</span>' : '') + '</div></a>';
  }).join('') || '<p class="empty">Aucun projet.</p>';
}

function poll() {
  fetch('api/projects', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (rows) {
    $('#live').className = 'live';
    $('#live span').textContent = 'En direct';
    renderProjects(rows);
  }).catch(function () {
    $('#live').className = 'live lost';
    $('#live span').textContent = 'Reconnexion…';
  });
}

setupTooltip();
poll();
setInterval(poll, 4000);
