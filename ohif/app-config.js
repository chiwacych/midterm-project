(function () {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('token') || '').trim();
  const dicomRoot = token ? `/dicomweb-token/${token}` : '/dicomweb';

  window.config = {
    routerBasename: '/',
    showStudyList: true,
    extensions: [],
    servers: {
      dicomWeb: [
        {
          name: 'MedImage Local DICOMweb',
          qidoRoot: dicomRoot,
          wadoRoot: dicomRoot,
          wadoUriRoot: `${dicomRoot}/wado`,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadouri',
          thumbnailRendering: 'wadouri',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: false,
        },
      ],
    },
  };
})();
